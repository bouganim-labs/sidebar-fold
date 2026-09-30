# Sidebar Fold

Sidebar Fold hides the Obsidian sidebars when you open a note, so you get the full width of the window for reading and writing. When you need the sidebar back, it opens at the width you left it.

I built it because I browse my vault in the left sidebar and then want the sidebar out of the way. Obsidian on mobile already does this. On desktop I was reaching for the toggle every single time.

## What it does

- Hides the left sidebar the moment you pick a note, or waits until you click into the note. You choose which.
- Can hide the right sidebar too, or leave it alone. The right sidebar is left alone by default.
- Push the mouse against the left edge of the window and the sidebar slides back out. Move back over your note and it folds away again.
- Remembers each sidebar's width and puts it back when the sidebar reopens.
- Leaves the sidebar open while you move through the file list with the arrow keys, so browsing still works.
- Leaves the sidebars alone while two notes are open side by side.
- Has a pin for the times you want the sidebar to stay, like filing or dragging notes into folders. Click the pin in the status bar, or give the "Pin sidebars open" command a hotkey.

It works with the core file explorer and with Notebook Navigator.

## Settings

| Setting | What it does | Default |
|---|---|---|
| Hide when | "I pick a note", "I click into the note", or either one | I pick a note |
| Hide the left sidebar | Fold the left sidebar | On |
| Hide the right sidebar | Fold the right sidebar | Off |
| Skip when the editor is split | Leave the sidebars alone with notes side by side | On |
| Which opens count | Any way a note opens (quick switcher, search, links, daily note), or only clicks in the left sidebar | Any way |
| Keep open while browsing with the keyboard | Arrow keys in the file list don't fold the sidebar | On |
| Delay | Wait up to one second before hiding | 0 ms |
| Open by touching the left edge | Mouse at the left edge of the window opens the left sidebar | On |
| Edge delay | How long the mouse rests at the edge first | 300 ms |
| Fold again when the mouse moves back | A sidebar opened from the edge folds once you're back over the note | On |
| Pin sidebars open | Pause all hiding | Off |
| Show pin in the status bar | Pin icon in the bottom bar | On |

## Commands

- **Pin sidebars open (pause auto-hide)** toggles the pin.
- **Hide sidebars now** folds both sidebars straight away.

Neither command has a default hotkey. Set one in Settings → Hotkeys.

## Installing

From Obsidian: Settings → Community plugins → Browse, search for "Sidebar Fold", then install and enable it.

By hand: download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/bouganim-labs/sidebar-fold/releases/latest) into `<your vault>/.obsidian/plugins/sidebar-fold/`, then enable it under Community plugins.

Desktop only. Obsidian on phones and tablets already closes the sidebar when you open a note.

## Privacy

The plugin makes no network requests and never reads or writes your notes. The only file it writes is its own settings file in the plugin folder.

## A note on how it's built

Obsidian doesn't publish an API for sidebar width, so the width memory uses the sidebar's internal size property. If a future Obsidian release changes that, the width memory will quietly stop working and everything else will carry on. I'll fix it when that happens.

## Support

Found a bug or have an idea? [Open an issue](https://github.com/bouganim-labs/sidebar-fold/issues).

If it saves you a few clicks a day, you can [buy me a coffee](https://buymeacoffee.com/bouganim).

## Licence

MIT. See [LICENSE](LICENSE).
