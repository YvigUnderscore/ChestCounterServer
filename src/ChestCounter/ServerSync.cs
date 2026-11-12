using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ChestCounter;

/// <summary>
/// Sends each counted match to the group server (self-hosted, see server/) and reads back the group figures.
///
/// Each player only sends what their own replay says about themselves: their chests, the match id
/// (GameSessionId, the same in every replay of the match), their team index and the Epic ids of their teammates.
/// The server adds the chests of the members of a team per match, so nobody is counted twice and a teammate
/// who does not use the counter simply shows as "no data".
///
/// The network calls run on a worker thread; the counter's data is only read and changed on the main loop
/// (<see cref="Tick"/>), like everywhere else in the tool.
/// </summary>
public static class ServerSync
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    /// <summary>Format of what is sent: raising it sends every match again once (2: chest times added).</summary>
    private const int WireVersion = 2;

    /// <summary>Most matches sent in one request (a first sync of a long history goes in several).</summary>
    private const int BatchSize = 40;

    private static readonly ConcurrentQueue<Action> Results = new();
    private static volatile bool _busy;
    private static DateTime _nextRefresh = DateTime.MinValue;
    private static DateTime _retryAfter = DateTime.MinValue;

    /// <summary>Last group figures read from the server for the profile shown (null until the first answer).</summary>
    public static GroupSummary? Group { get; private set; }

    /// <summary>"" when everything went fine, otherwise why the last call failed (shown in the settings).</summary>
    public static string LastError { get; private set; } = "";

    public static DateTime? LastSuccessUtc { get; private set; }

    /// <summary>True when the group figures changed since the last call (the overlay must be redrawn).</summary>
    public static bool Changed { get; private set; }

    /// <summary>Wakes the main loop up when an answer arrives (set by Program).</summary>
    public static Action? Wake { get; set; }

    public static bool Enabled(Config c) => Uri.TryCreate(c.ServerUrl?.Trim(), UriKind.Absolute, out var u) && u.Scheme is "http" or "https";

    /// <summary>A setting changed: send everything again to the new server, refresh now.</summary>
    public static void Reset()
    {
        Group = null;
        LastError = "";
        _nextRefresh = DateTime.MinValue;
        _retryAfter = DateTime.MinValue;
        Changed = true;
    }

    /// <summary>Called on the main loop: applies the answers received, then starts the next call when one is due.</summary>
    /// <returns>True when the data was changed (to be saved).</returns>
    public static bool Tick(Store store, Config config, TrackerData data)
    {
        var profileEpicId = Profiles.Current(data, config)?.Key;
        Changed = false;
        var dirty = false;
        while (Results.TryDequeue(out var apply))
        {
            apply();
            dirty = true;
        }
        if (dirty)
        {
            store.SaveData(data);
        }

        if (!Enabled(config) || _busy || DateTime.UtcNow < _retryAfter)
        {
            return dirty;
        }

        var baseUrl = config.ServerUrl.Trim().TrimEnd('/');
        var stamp = (string sessionId, int version) => $"{baseUrl}|{version}|{WireVersion}";
        var pending = data.Matches
            .Where(m => !string.IsNullOrEmpty(m.EpicId) && GameModes.Counts(m))
            .Where(m => data.Synced.GetValueOrDefault(m.SessionId) != stamp(m.SessionId, m.AnalyzerVersion))
            .OrderBy(m => m.MatchStartUtc ?? m.AnalyzedAtUtc)
            .Take(BatchSize)
            .ToList();

        if (pending.Count == 0 && DateTime.UtcNow < _nextRefresh)
        {
            return dirty;
        }

        var payload = pending.Count == 0 ? null : new UploadPayload(AppInfo.VersionText, pending.Select(ToWire).ToList());
        var stamps = pending.Select(m => (m.SessionId, Stamp: stamp(m.SessionId, m.AnalyzerVersion))).ToList();
        var key = config.ServerKey?.Trim() ?? "";
        _busy = true;
        Task.Run(async () =>
        {
            try
            {
                if (payload != null)
                {
                    using var post = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/api/matches")
                    {
                        Content = JsonContent.Create(payload, options: Json),
                    };
                    post.Headers.Add("X-Group-Key", key);
                    using var answer = await Http.SendAsync(post);
                    await EnsureOk(answer);
                    var result = await answer.Content.ReadFromJsonAsync<UploadResult>(Json);
                    var accepted = result?.Accepted?.ToHashSet() ?? new HashSet<string>();
                    Results.Enqueue(() =>
                    {
                        foreach (var (sessionId, s) in stamps.Where(x => accepted.Contains(x.SessionId)))
                        {
                            data.Synced[sessionId] = s;
                        }
                    });
                }

                GroupSummary? group = null;
                if (payload == null && string.IsNullOrEmpty(profileEpicId))
                {
                    // No match yet: check the address and the key anyway, so a mistake shows at once in the settings.
                    using var ping = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/ping");
                    ping.Headers.Add("X-Group-Key", key);
                    using var pong = await Http.SendAsync(ping);
                    await EnsureOk(pong);
                }
                else if (!string.IsNullOrEmpty(profileEpicId))
                {
                    using var get = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}/api/players/{Uri.EscapeDataString(profileEpicId)}/summary");
                    get.Headers.Add("X-Group-Key", key);
                    using var answer = await Http.SendAsync(get);
                    if ((int)answer.StatusCode != 404)
                    {
                        await EnsureOk(answer);
                        group = await answer.Content.ReadFromJsonAsync<GroupSummary>(Json);
                    }
                }
                Results.Enqueue(() =>
                {
                    Changed = Changed || JsonSerializer.Serialize(group, Json) != JsonSerializer.Serialize(Group, Json);
                    Group = group;
                    LastError = "";
                    LastSuccessUtc = DateTime.UtcNow;
                    _nextRefresh = DateTime.UtcNow.AddSeconds(45);
                });
            }
            catch (Exception ex)
            {
                var message = ex is TaskCanceledException ? L.T("le serveur ne répond pas", "the server does not answer", "el servidor no responde") : ex.Message;
                Results.Enqueue(() =>
                {
                    Changed = Changed || LastError != message;
                    LastError = message;
                    _retryAfter = DateTime.UtcNow.AddSeconds(60);
                });
            }
            finally
            {
                _busy = false;
                Wake?.Invoke();
            }
        });
        return dirty;
    }

    /// <summary>
    /// Sends every match not sent yet and waits for the answers (--once). Returns null when all went fine,
    /// otherwise the error.
    /// </summary>
    public static string? RunToEnd(Store store, Config config, TrackerData data, TimeSpan limit)
    {
        var until = DateTime.UtcNow + limit;
        var before = -1;
        while (DateTime.UtcNow < until)
        {
            _retryAfter = DateTime.MinValue;
            Tick(store, config, data);
            while (_busy && DateTime.UtcNow < until)
            {
                Thread.Sleep(100);
            }
            Tick(store, config, data); // applies the answer
            if (LastError != "")
            {
                return LastError;
            }
            if (data.Synced.Count == before)
            {
                return null; // nothing more was accepted: done
            }
            before = data.Synced.Count;
        }
        return L.T("délai dépassé", "timed out", "tiempo agotado");
    }

    private static async Task EnsureOk(HttpResponseMessage answer)
    {
        if (answer.IsSuccessStatusCode)
        {
            return;
        }
        var body = "";
        try { body = (await answer.Content.ReadAsStringAsync()).Trim(); } catch { /* ignore */ }
        if (body.Length > 200) body = body[..200];
        throw new InvalidOperationException((int)answer.StatusCode switch
        {
            401 or 403 => L.T("clé de groupe refusée", "group key refused", "clave de grupo rechazada"),
            _ => $"HTTP {(int)answer.StatusCode} {body}",
        });
    }

    /// <summary>What is sent for one match: only the player's own figures and the Epic ids of their team.</summary>
    private static WireMatch ToWire(MatchRecord m) => new(
        m.SessionId,
        m.EpicId!,
        m.PlayerName ?? "",
        m.MatchStartUtc,
        m.DurationSeconds,
        m.Playlist,
        m.Map,
        m.Placement,
        m.TotalPlayers,
        m.Eliminations,
        m.TeamIndex,
        m.ChestsOpened,
        m.Chests.Count(c => c.Destroyed),
        m.Chests.GroupBy(c => ChestKinds.Canonical(c.Kind)).ToDictionary(g => g.Key, g => g.Count()),
        // When each chest was opened (seconds after the match start): a chest of a Treasure Hour has boosted odds.
        m.Chests.Select(c => (int)MathF.Round(c.TimeSeconds)).ToList(),
        m.TreasureFinds.Select(t => new WireTreasure(t.PrizeId, t.DisplayName, t.ObtainedAtSeconds)).ToList(),
        // Teammates: Epic ids only (no names): the server shows a name only for the players of the group.
        m.Squad.Where(s => !string.IsNullOrEmpty(s.EpicId)).Select(s => new WireMate(s.EpicId!, s.IsBot)).ToList(),
        m.AnalyzerVersion);

    private sealed record UploadPayload(string Client, List<WireMatch> Matches);
    private sealed record WireMatch(string SessionId, string EpicId, string Name, DateTime? StartUtc, int? DurationSeconds, string? Playlist, string? Map,
        int? Placement, int? TotalPlayers, int? Eliminations, int? TeamIndex, int Chests, int Destroyed, Dictionary<string, int> ChestKinds, List<int> ChestSeconds,
        List<WireTreasure> Treasures, List<WireMate> Squad, int AnalyzerVersion);
    private sealed record WireTreasure(string? PrizeId, string Name, float? AtSeconds);
    private sealed record WireMate(string EpicId, bool IsBot);
    private sealed record UploadResult(List<string>? Accepted);
}

/// <summary>Group figures of a player, as answered by the server (GET /api/players/{epicId}/summary).</summary>
public sealed class GroupSummary
{
    public string? GroupName { get; set; }
    public string? DashboardUrl { get; set; }
    public GroupGame? LastGame { get; set; }
    /// <summary>Chests of the player's teams today, all members added (each counted once).</summary>
    public int TodayTeamChests { get; set; }
    public int TodayGames { get; set; }
    /// <summary>Chests of every player of the group, all time.</summary>
    public int GroupTotal { get; set; }
}

public sealed class GroupGame
{
    public string SessionId { get; set; } = "";
    public DateTime? StartUtc { get; set; }
    public int TeamChests { get; set; }
    /// <summary>Human teammates (the player included) that sent this match, and how many there were.</summary>
    public int Reported { get; set; }
    public int Humans { get; set; }
    public bool Complete { get; set; }
    public bool Consistent { get; set; } = true;
    public List<GroupMember> Members { get; set; } = new();
}

public sealed class GroupMember
{
    public string Name { get; set; } = "";
    public int? Chests { get; set; }
    public bool Me { get; set; }
}
