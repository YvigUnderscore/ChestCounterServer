**English** · Group server edition of [LED-N's Chest Counter](https://github.com/LED-N/Fortnite-ChestCounter), based on its 1.5.1. Download **`ChestCounter.exe`** below and run it, nothing to install; replace the previous one, your history and settings are kept. **`chestcounter-server.tar`** is the server's Docker image (Portainer: *Images → Import*, or `docker load`); see [SERVER.md](https://github.com/YvigUnderscore/ChestCounterServer/blob/main/SERVER.md).

> **Turn on replays in Fortnite first**: *Settings → Game → Replays → Record Replays: On*. The tool only reads these replay files: no game modification, no access to the game's memory. Without a group server, nothing is sent; with one, only your own chests, the match id, your team and your teammates' Epic ids. Automatic updates are off in this edition (they would install the original version, without the server).

**What's new in 1.5.1 · group server edition**
- **Group server website in French, English and Spanish**: French by default (`DEFAULT_LANG`), each visitor picks their language at the top; the OBS overlay follows `?lang=`
- **Odds on the website as in the counter**: the weekly treasures count this week's chests only, with a line for the whole hunt, and a chance is never shown as 100%
- **From Chest Counter 1.5.1** (LED-N): clearer *Your chances* with countdowns (thanks koiseka, LED-N/Fortnite-ChestCounter#23), times in local time or UTC on a 12- or 24-hour clock, the last match stays on the overlay during the next one, the pencil of *Chests in total* keeps a history, and the Activity log no longer jumps to the top (thanks tbpg58, LED-N/Fortnite-ChestCounter#24)
- **Fix**: closed chests broken without touching them are counted again; the replays still on your PC are analyzed again and their matches sent to the server again
- The server image is now built and attached to each release by GitHub
- **Server fix (server.2)**: matches sent by older builds of the counter, without the time of each chest, count in the week of their match (without Treasure Hour boost) instead of being left out of the weekly odds

Windows may show *"Windows protected your PC"* (unsigned exe): *More info → Run anyway*.

---

**Français** · Édition « serveur de groupe » du [compteur de coffres de LED-N](https://github.com/LED-N/Fortnite-ChestCounter), basée sur sa 1.5.1. Télécharge **`ChestCounter.exe`** ci-dessous et lance-le, rien à installer ; remplace l'ancien, ton historique et tes réglages sont conservés. **`chestcounter-server.tar`** est l'image Docker du serveur (Portainer : *Images → Import*, ou `docker load`) ; voir [SERVEUR.md](https://github.com/YvigUnderscore/ChestCounterServer/blob/main/SERVEUR.md).

> **Active d'abord les rediffusions dans Fortnite** : *Paramètres → Jeu → Rediffusions → Enregistrer les rediffusions : Activé*. L'outil lit uniquement ces fichiers replay : aucune modification du jeu, aucun accès à la mémoire du jeu. Sans serveur de groupe, rien n'est envoyé ; avec un serveur, seulement tes propres coffres, l'identifiant de la partie, ton équipe et les identifiants Epic de tes coéquipiers. Les mises à jour automatiques sont désactivées dans cette édition (elles installeraient la version d'origine, sans le serveur).

**Nouveautés de la 1.5.1 · édition serveur de groupe**
- **Site du serveur de groupe en français, anglais et espagnol** : français par défaut (`DEFAULT_LANG`), chacun choisit sa langue en haut ; l'overlay OBS suit `?lang=`
- **Chances du site comme dans le compteur** : les trésors de la semaine ne comptent que les coffres de la semaine, avec une ligne pour toute la chasse, et une chance n'est jamais affichée à 100 %
- **Du compteur 1.5.1** (LED-N) : *Tes chances* plus claires avec des comptes à rebours (merci koiseka, LED-N/Fortnite-ChestCounter#23), heures en heure locale ou UTC sur 12 ou 24 heures, la dernière partie reste sur l'overlay pendant la suivante, le crayon de *Coffres au total* garde un historique, et le journal d'activité ne remonte plus tout seul (merci tbpg58, LED-N/Fortnite-ChestCounter#24)
- **Correction** : les coffres fermés cassés sans les toucher sont de nouveau comptés ; les replays encore sur ton PC sont réanalysés et leurs parties renvoyées au serveur
- L'image du serveur est maintenant construite et jointe à chaque version par GitHub
- **Correction du serveur (server.2)** : les parties envoyées par d'anciennes versions du compteur, sans l'heure de chaque coffre, comptent dans la semaine de leur partie (sans bonus d'heure du trésor) au lieu d'être exclues des chances de la semaine

Windows peut afficher « Windows a protégé votre ordinateur » (exe non signé) : *Informations complémentaires → Exécuter quand même*.

---

**Español** · Edición «servidor de grupo» del [contador de cofres de LED-N](https://github.com/LED-N/Fortnite-ChestCounter), basada en su 1.5.1. Descarga **`ChestCounter.exe`** aquí abajo y ejecútalo, no hay nada que instalar; sustituye al anterior, tu historial y tus ajustes se conservan. **`chestcounter-server.tar`** es la imagen Docker del servidor (Portainer: *Images → Import*, o `docker load`); ver [SERVIDOR.md](https://github.com/YvigUnderscore/ChestCounterServer/blob/main/SERVIDOR.md).

> **Activa primero las repeticiones en Fortnite**: *Ajustes → Juego → Repeticiones → Grabar repeticiones: Activado*. La herramienta solo lee esos archivos de repetición: ninguna modificación del juego, ningún acceso a la memoria del juego. Sin servidor de grupo, no se envía nada; con uno, solo tus propios cofres, el id de la partida, tu equipo y los ids de Epic de tus compañeros. Las actualizaciones automáticas están desactivadas en esta edición (instalarían la versión original, sin el servidor).

**Novedades de la 1.5.1 · edición servidor de grupo**
- **Sitio del servidor de grupo en francés, inglés y español**: francés por defecto (`DEFAULT_LANG`), cada visitante elige su idioma arriba; el overlay de OBS sigue `?lang=`
- **Probabilidades del sitio como en el contador**: los tesoros semanales solo cuentan los cofres de la semana, con una línea para toda la búsqueda, y una probabilidad nunca se muestra al 100 %
- **Del contador 1.5.1** (LED-N): *Tus probabilidades* más claras con cuentas atrás (gracias koiseka, LED-N/Fortnite-ChestCounter#23), horas en hora local o UTC con reloj de 12 o 24 horas, la última partida sigue en el overlay durante la siguiente, el lápiz de *Cofres en total* guarda un historial, y el registro de Actividad ya no vuelve solo arriba (gracias tbpg58, LED-N/Fortnite-ChestCounter#24)
- **Corrección**: los cofres cerrados rotos sin tocarlos vuelven a contarse; las repeticiones que siguen en tu PC se analizan de nuevo y sus partidas se reenvían al servidor
- La imagen del servidor ahora la construye GitHub y la adjunta a cada versión
- **Corrección del servidor (server.2)**: las partidas enviadas por versiones antiguas del contador, sin la hora de cada cofre, cuentan en la semana de su partida (sin bonificación de hora del tesoro) en lugar de quedar fuera de las probabilidades semanales

Windows puede mostrar «Windows protegió tu PC» (exe sin firmar): *Más información → Ejecutar de todas formas*.
