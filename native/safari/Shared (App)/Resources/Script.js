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
