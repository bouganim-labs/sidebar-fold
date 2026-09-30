import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	WorkspaceParent,
	WorkspaceSidedock,
	setIcon,
} from "obsidian";

// Credit block at the top of the settings page.
const AUTHOR = "Jeff Bouganim";
const REPO_URL = "https://github.com/bouganim-labs/sidebar-fold";
const COFFEE_URL = "https://buymeacoffee.com/bouganim";

type OpenTrigger = "any" | "sidebar";
type HideWhen = "open" | "click" | "both";

interface SidebarFoldSettings {
	hideWhen: HideWhen;
	hideLeft: boolean;
	hideRight: boolean;
	openTrigger: OpenTrigger;
	skipWhenSplit: boolean;
	keepOpenWhileKeyboardBrowsing: boolean;
	delayMs: number;
	hoverReveal: boolean;
	hoverDelayMs: number;
	hoverAutoClose: boolean;
	showStatusBarPin: boolean;
	pinned: boolean;
	// Last width of each sidebar before we folded it, restored when it reopens.
	leftWidth: number | null;
	rightWidth: number | null;
}

const DEFAULT_SETTINGS: SidebarFoldSettings = {
	hideWhen: "open",
	hideLeft: true,
	hideRight: false,
	openTrigger: "any",
	skipWhenSplit: true,
	keepOpenWhileKeyboardBrowsing: true,
	delayMs: 0,
	hoverReveal: true,
	hoverDelayMs: 300,
	hoverAutoClose: true,
	showStatusBarPin: true,
	pinned: false,
	leftWidth: null,
	rightWidth: null,
};

// Settings from 1.0.0 that were folded into hideWhen / hideLeft / hideRight in 1.1.0.
const RETIRED_KEYS = [
	"hideLeftOnOpen",
	"hideRightOnOpen",
	"hideLeftOnEditorClick",
	"hideRightOnEditorClick",
];

// How close to the left edge of the window (px) the mouse must be to reveal the sidebar.
const HOVER_EDGE_PX = 8;
// How long the mouse must stay over the note before a hover-opened sidebar folds again.
const HOVER_CLOSE_MS = 400;

// How recent the last click/keypress must be to count as the cause of a note opening.
const INPUT_WINDOW_MS = 1500;

// Clicks on these inside the note area keep the sidebars as they are,
// because they usually open something in a sidebar (tags, properties) or are chrome.
const EDITOR_CLICK_EXCLUSIONS = [
	".workspace-tab-header-container",
	".view-header",
	".cm-hashtag",
	".tag",
	".multi-select-pill-content",
	".snw-reference",
];

interface LastInput {
	kind: "pointer" | "key";
	inLeftSidebar: boolean;
	at: number;
}

// rootSplit and the sidedocks carry containerEl at runtime but not in the public typings.
function elOf(item: unknown): HTMLElement | null {
	return (item as { containerEl?: HTMLElement }).containerEl ?? null;
}

// size and setSize are on the sidedock at runtime but not in the public typings.
type SizedDock = { size?: number; setSize?: (n: number) => void };

function dockSize(dock: WorkspaceSidedock): number {
	return (dock as unknown as SizedDock).size ?? 0;
}

function setDockSize(dock: WorkspaceSidedock, px: number) {
	const d = dock as unknown as SizedDock;
	if (typeof d.setSize === "function") d.setSize(px);
}

export default class SidebarFoldPlugin extends Plugin {
	settings!: SidebarFoldSettings;
	private lastInput: LastInput | null = null;
	private statusBarEl: HTMLElement | null = null;
	private pendingTimer: number | null = null;
	private hoverOpenTimer: number | null = null;
	private hoverCloseTimer: number | null = null;
	// True while the left sidebar is open because the mouse touched the edge.
	private peeking = false;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new SidebarFoldSettingTab(this.app, this));

		this.addCommand({
			id: "toggle-pin",
			name: "Pin sidebars open (pause auto-hide)",
			callback: () => this.setPinned(!this.settings.pinned),
		});
		this.addCommand({
			id: "hide-sidebars-now",
			name: "Hide sidebars now",
			callback: () => this.fold(true, true),
		});

		this.statusBarEl = this.addStatusBarItem();
		this.statusBarEl.addClass("sidebar-fold-pin", "mod-clickable");
		this.registerDomEvent(this.statusBarEl, "click", () =>
			this.setPinned(!this.settings.pinned),
		);
		this.renderStatusBar();

		// Wait for the layout so restoring the workspace at startup doesn't fold anything.
		this.app.workspace.onLayoutReady(() => {
			this.registerInputTracking();
			this.registerEvent(
				this.app.workspace.on("file-open", (file) => this.onFileOpen(file)),
			);
			this.registerDomEvent(document, "click", (evt) => this.onDocumentClick(evt));
			this.registerDomEvent(document, "mousemove", (evt) => this.onMouseMove(evt));
			this.watchReopen("left");
			this.watchReopen("right");
		});
	}

	onunload() {
		this.clearPending();
		this.clearHoverOpen();
		this.clearHoverClose();
	}

	async loadSettings() {
		const saved = ((await this.loadData()) ?? {}) as Record<string, unknown>;
		for (const key of RETIRED_KEYS) delete saved[key];
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.renderStatusBar();
	}

	async setPinned(pinned: boolean) {
		this.settings.pinned = pinned;
		if (pinned) this.clearPending();
		await this.saveSettings();
	}

	renderStatusBar() {
		const el = this.statusBarEl;
		if (!el) return;
		el.empty();
		el.toggle(this.settings.showStatusBarPin);
		setIcon(el, this.settings.pinned ? "pin" : "pin-off");
		el.setAttr(
			"aria-label",
			this.settings.pinned
				? "Sidebars pinned open. Click to resume auto-hide."
				: "Sidebar auto-hide is on. Click to pin sidebars open.",
		);
		el.toggleClass("is-pinned", this.settings.pinned);
	}

	// Remember what the user last did and where, so a note opening can be traced
	// back to a click in the sidebar or to arrow-key browsing in the file list.
	private registerInputTracking() {
		const record = (kind: LastInput["kind"]) => (evt: Event) => {
			const leftEl = elOf(this.app.workspace.leftSplit);
			this.lastInput = {
				kind,
				inLeftSidebar: !!leftEl && evt.target instanceof Node && leftEl.contains(evt.target),
				at: Date.now(),
			};
		};
		// Capture phase so we see the event before the sidebar view handles it.
		this.registerDomEvent(document, "pointerdown", record("pointer"), { capture: true });
		this.registerDomEvent(document, "keydown", record("key"), { capture: true });
	}

	private recentInput(): LastInput | null {
		if (!this.lastInput) return null;
		return Date.now() - this.lastInput.at <= INPUT_WINDOW_MS ? this.lastInput : null;
	}

	private onFileOpen(file: TFile | null) {
		const s = this.settings;
		if (!file || s.pinned || s.hideWhen === "click") return;
		if (s.skipWhenSplit && this.isEditorSplit()) return;

		const input = this.recentInput();
		const fromSidebar = !!input && input.inLeftSidebar;
		if (s.openTrigger === "sidebar" && !fromSidebar) return;
		if (s.keepOpenWhileKeyboardBrowsing && fromSidebar && input?.kind === "key") return;

		this.schedule(() => this.fold(s.hideLeft, s.hideRight));
	}

	private onDocumentClick(evt: MouseEvent) {
		const s = this.settings;
		if (s.pinned || s.hideWhen === "open") return;
		const target = evt.target;
		if (!(target instanceof HTMLElement)) return;
		const rootEl = elOf(this.app.workspace.rootSplit);
		if (!rootEl || !rootEl.contains(target)) return;
		if (EDITOR_CLICK_EXCLUSIONS.some((sel) => target.closest(sel))) return;
		this.fold(s.hideLeft, s.hideRight);
	}

	// True when the main area shows more than one tab group side by side.
	private isEditorSplit(): boolean {
		const groups = new Set<WorkspaceParent>();
		this.app.workspace.iterateRootLeaves((leaf: WorkspaceLeaf) => {
			if (leaf.parent) groups.add(leaf.parent);
		});
		return groups.size > 1;
	}

	private schedule(fn: () => void) {
		this.clearPending();
		if (this.settings.delayMs <= 0) {
			fn();
			return;
		}
		this.pendingTimer = window.setTimeout(() => {
			this.pendingTimer = null;
			fn();
		}, this.settings.delayMs);
	}

	private clearPending() {
		if (this.pendingTimer !== null) {
			window.clearTimeout(this.pendingTimer);
			this.pendingTimer = null;
		}
	}

	fold(left: boolean, right: boolean) {
		let widthChanged = false;
		const collapse = (side: "left" | "right") => {
			const dock = this.dock(side);
			if (dock.collapsed) return;
			const key = side === "left" ? "leftWidth" : "rightWidth";
			const size = dockSize(dock);
			if (size > 0 && this.settings[key] !== size) {
				this.settings[key] = size;
				widthChanged = true;
			}
			dock.collapse();
		};
		if (left) collapse("left");
		if (right) collapse("right");
		if (widthChanged) void this.saveSettings();
	}

	// Mouse at the left edge opens a folded left sidebar; moving back over the
	// note folds it again if it was opened this way.
	private onMouseMove(evt: MouseEvent) {
		const s = this.settings;
		const left = this.app.workspace.leftSplit;

		if (s.hoverReveal && left.collapsed && evt.clientX <= HOVER_EDGE_PX) {
			if (this.hoverOpenTimer === null) {
				this.hoverOpenTimer = window.setTimeout(() => {
					this.hoverOpenTimer = null;
					if (!left.collapsed) return;
					left.expand();
					this.peeking = true;
				}, s.hoverDelayMs);
			}
		} else {
			this.clearHoverOpen();
		}

		if (!this.peeking) return;
		if (left.collapsed) {
			this.peeking = false;
			this.clearHoverClose();
			return;
		}
		if (!s.hoverAutoClose || s.pinned) return;
		const rootEl = elOf(this.app.workspace.rootSplit);
		const overNote = !!rootEl && evt.target instanceof Node && rootEl.contains(evt.target);
		if (!overNote) {
			this.clearHoverClose();
		} else if (this.hoverCloseTimer === null) {
			this.hoverCloseTimer = window.setTimeout(() => {
				this.hoverCloseTimer = null;
				this.peeking = false;
				this.fold(true, false);
			}, HOVER_CLOSE_MS);
		}
	}

	private clearHoverOpen() {
		if (this.hoverOpenTimer !== null) {
			window.clearTimeout(this.hoverOpenTimer);
			this.hoverOpenTimer = null;
		}
	}

	private clearHoverClose() {
		if (this.hoverCloseTimer !== null) {
			window.clearTimeout(this.hoverCloseTimer);
			this.hoverCloseTimer = null;
		}
	}

	private dock(side: "left" | "right"): WorkspaceSidedock {
		return side === "left" ? this.app.workspace.leftSplit : this.app.workspace.rightSplit;
	}

	// When a sidebar we folded opens again, however it's opened, put its width back.
	private watchReopen(side: "left" | "right") {
		const dock = this.dock(side);
		const el = elOf(dock);
		if (!el) return;
		let wasCollapsed = dock.collapsed;
		const observer = new MutationObserver(() => {
			const nowCollapsed = dock.collapsed;
			if (wasCollapsed && !nowCollapsed) {
				const width = this.settings[side === "left" ? "leftWidth" : "rightWidth"];
				if (width && Math.abs(dockSize(dock) - width) > 1) setDockSize(dock, width);
			}
			wasCollapsed = nowCollapsed;
		});
		observer.observe(el, { attributes: true, attributeFilter: ["class"] });
		this.register(() => observer.disconnect());
	}
}

class SidebarFoldSettingTab extends PluginSettingTab {
	plugin: SidebarFoldPlugin;

	constructor(app: App, plugin: SidebarFoldPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		containerEl.empty();

		const credit = containerEl.createDiv({ cls: "sidebar-fold-credit" });
		credit.createEl("strong", { text: `Sidebar Fold ${this.plugin.manifest.version}` });
		credit.createSpan({ text: ` by ${AUTHOR}. ` });
		credit.createEl("a", { text: "Source on GitHub", href: REPO_URL });
		credit.createSpan({ text: " · " });
		credit.createEl("a", { text: "Buy me a coffee", href: COFFEE_URL });

		new Setting(containerEl).setName("Hiding").setHeading();

		new Setting(containerEl)
			.setName("Hide when")
			.setDesc(
				"Pick a note hides the sidebar the moment a note opens. Click into the note waits until you click in the note itself, so you can keep browsing first.",
			)
			.addDropdown((d) =>
				d
					.addOption("open", "I pick a note")
					.addOption("click", "I click into the note")
					.addOption("both", "Either one")
					.setValue(s.hideWhen)
					.onChange(async (v) => {
						s.hideWhen = v as HideWhen;
						await save();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Hide the left sidebar")
			.setDesc("File explorer, search and other left-side panels.")
			.addToggle((t) =>
				t.setValue(s.hideLeft).onChange(async (v) => {
					s.hideLeft = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Hide the right sidebar")
			.setDesc("Outline, backlinks, properties.")
			.addToggle((t) =>
				t.setValue(s.hideRight).onChange(async (v) => {
					s.hideRight = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName("Skip when the editor is split")
			.setDesc("Leave the sidebars alone while two or more notes are side by side.")
			.addToggle((t) =>
				t.setValue(s.skipWhenSplit).onChange(async (v) => {
					s.skipWhenSplit = v;
					await save();
				}),
			);

		if (s.hideWhen !== "click") {
			new Setting(containerEl).setName("When you pick a note").setHeading();

			new Setting(containerEl)
				.setName("Which opens count")
				.setDesc(
					"Any open includes quick switcher, search, links and the daily note. Sidebar only reacts to clicks in the left sidebar, such as your file explorer.",
				)
				.addDropdown((d) =>
					d
						.addOption("any", "Any way a note opens")
						.addOption("sidebar", "Only from the left sidebar")
						.setValue(s.openTrigger)
						.onChange(async (v) => {
							s.openTrigger = v as OpenTrigger;
							await save();
						}),
				);

			new Setting(containerEl)
				.setName("Keep open while browsing with the keyboard")
				.setDesc(
					"Arrow keys in the file list open each note as you pass it. Leave this on so the sidebar stays while you browse.",
				)
				.addToggle((t) =>
					t.setValue(s.keepOpenWhileKeyboardBrowsing).onChange(async (v) => {
						s.keepOpenWhileKeyboardBrowsing = v;
						await save();
					}),
				);

			new Setting(containerEl)
				.setName("Delay")
				.setDesc("Wait this long (milliseconds) before hiding. Set to 0 to hide right away.")
				.addSlider((sl) =>
					sl
						.setLimits(0, 1000, 50)
						.setValue(s.delayMs)
						.onChange(async (v) => {
							s.delayMs = v;
							await save();
						}),
				);
		}

		new Setting(containerEl).setName("Opening again").setHeading();

		new Setting(containerEl)
			.setName("Open by touching the left edge")
			.setDesc("Push the mouse against the left edge of the window to slide the left sidebar back out.")
			.addToggle((t) =>
				t.setValue(s.hoverReveal).onChange(async (v) => {
					s.hoverReveal = v;
					await save();
					this.display();
				}),
			);

		if (s.hoverReveal) {
			new Setting(containerEl)
				.setName("Edge delay")
				.setDesc("How long (milliseconds) the mouse rests at the edge before the sidebar opens.")
				.addSlider((sl) =>
					sl
						.setLimits(0, 1000, 50)
						.setValue(s.hoverDelayMs)
						.onChange(async (v) => {
							s.hoverDelayMs = v;
							await save();
						}),
				);

			new Setting(containerEl)
				.setName("Fold again when the mouse moves back")
				.setDesc("A sidebar opened from the edge folds once the mouse rests over the note.")
				.addToggle((t) =>
					t.setValue(s.hoverAutoClose).onChange(async (v) => {
						s.hoverAutoClose = v;
						await save();
					}),
				);
		}

		new Setting(containerEl).setName("Pin").setHeading();

		new Setting(containerEl)
			.setName("Pin sidebars open")
			.setDesc(
				"Pauses all auto-hiding, for filing or drag and drop. Also available as a command you can give a hotkey.",
			)
			.addToggle((t) =>
				t.setValue(s.pinned).onChange(async (v) => {
					await this.plugin.setPinned(v);
				}),
			);

		new Setting(containerEl)
			.setName("Show pin in the status bar")
			.setDesc("A pin icon in the bottom bar. Click it to pin or unpin.")
			.addToggle((t) =>
				t.setValue(s.showStatusBarPin).onChange(async (v) => {
					s.showStatusBarPin = v;
					await save();
				}),
			);
	}
}
