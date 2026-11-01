const theme = matchMedia("(prefers-color-scheme: dark)");
function updateTheme() {
    document.documentElement.dataset.theme = theme.matches ? "aitetsu" : "chitosemidori";
}
theme.addEventListener("change", updateTheme);
updateTheme();

// modernSettings means Settings on macOS 13+, and Settings > Apps on iOS 18+.
globalThis.show = function(platform, enabled, modernSettings = true) {
    if (!["ios", "mac"].includes(platform)) return;
    document.body.classList.remove("platform-ios", "platform-mac");
    document.body.classList.add(`platform-${platform}`);
    document.querySelector(".ios-apps").hidden = !modernSettings;
    const settingsName = modernSettings ? "設定" : "環境設定";
    document.querySelector(".settings-name").textContent = settingsName;
    document.querySelector(".open-preferences").textContent = `Safariの${settingsName}を開く ↗`;
    const status = document.querySelector("#extension-state");
    status.classList.toggle("enabled", enabled === true);
    status.textContent = enabled === true ? "✓ Sche10leは有効です。ページから使えます。" :
        enabled === false ? "Sche10leはまだ有効になっていません。" :
        `有効になっているかは、Safariの${settingsName}で確認できます。`;
};

globalThis.showSettingsResult = function(succeeded) {
    document.querySelector(".open-preferences").disabled = false;
    const error = document.querySelector("#settings-error");
    error.hidden = succeeded;
    error.textContent = succeeded ? "" : "Safariの設定を開けませんでした。Safariのメニューから「設定」または「環境設定」を開いてください。";
};

document.querySelector(".open-preferences").addEventListener("click", (event) => {
    event.currentTarget.disabled = true;
    document.querySelector("#settings-error").hidden = true;
    try {
        window.webkit.messageHandlers.controller.postMessage("open-preferences");
    } catch {
        globalThis.showSettingsResult(false);
    }
});

const iconChoices = globalThis.APP_ICONS ?? [];
const iconButtons = new Map();
let iconState = { supported: false, current: null, busy: false };
const settingsButton = document.querySelector(".app-settings");
const backButton = document.querySelector(".app-back");
const iconError = document.querySelector("#icon-error");
const iconStatus = document.querySelector("#icon-status");

function renderIconState() {
    for (const [id, button] of iconButtons) {
        button.disabled = !iconState.supported || iconState.busy;
        button.setAttribute("aria-pressed", String(iconState.current === id));
    }
}
function iconBridgeFailure() {
    iconState.busy = false;
    renderIconState();
    iconStatus.textContent = "";
    iconError.textContent = "設定を変更できませんでした。もう一度お試しください。";
    iconError.hidden = false;
}

globalThis.showIconState = function(state) {
    const current = iconChoices.find(icon => icon.id === state.current);
    iconState = { supported: state.supported === true, current: current?.id ?? null, busy: state.busy === true };
    renderIconState();
    iconError.hidden = !state.error;
    iconError.textContent = state.error ? "アイコンを変更できませんでした。もう一度お試しください。" : "";
    iconStatus.textContent = !iconState.supported ? "この環境ではアイコンを変更できません。" :
        iconState.busy ? "アイコンを変更しています。" : current ? `現在のアイコン：${current.name}` : "現在のアイコンを確認できませんでした。";
};

for (const icon of iconChoices) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "icon-choice";
    button.disabled = true;
    button.setAttribute("aria-pressed", "false");
    button.setAttribute("aria-label", `${icon.name}（${icon.reading}）`);
    const image = document.createElement("img");
    image.src = icon.image;
    image.width = image.height = 64;
    image.alt = "";
    const label = document.createElement("span");
    label.className = "icon-choice-label";
    label.textContent = icon.name;
    const reading = document.createElement("small");
    reading.textContent = icon.reading;
    button.append(image, label, reading);
    button.addEventListener("click", () => {
        if (!iconState.supported || iconState.busy || iconState.current === icon.id) return;
        iconState.busy = true;
        renderIconState();
        iconError.hidden = true;
        iconStatus.textContent = "アイコンを変更しています。";
        try {
            window.webkit.messageHandlers.controller.postMessage({ action: "set-icon", name: icon.id });
        } catch { iconBridgeFailure(); }
    });
    iconButtons.set(icon.id, button);
    document.querySelector(".icon-choices").append(button);
}

settingsButton.addEventListener("click", () => {
    document.querySelector(".guide").hidden = true;
    document.querySelector(".intro").hidden = true;
    document.querySelector(".icon-settings").hidden = false;
    document.querySelector("h1").textContent = "アプリの設定";
    settingsButton.hidden = true;
    backButton.hidden = false;
    document.querySelector("#icon-heading").focus();
    try { window.webkit.messageHandlers.controller.postMessage("get-icon-state"); }
    catch { iconBridgeFailure(); }
});
backButton.addEventListener("click", () => {
    document.querySelector(".guide").hidden = false;
    document.querySelector(".intro").hidden = false;
    document.querySelector(".icon-settings").hidden = true;
    document.querySelector("h1").textContent = "Safariで使う準備";
    settingsButton.hidden = false;
    backButton.hidden = true;
    settingsButton.focus();
});
