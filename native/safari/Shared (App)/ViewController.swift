import WebKit

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#elseif os(macOS)
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

// WKUserContentController retains its handlers; do not retain the view controller.
private final class ScriptMessageRelay: NSObject, WKScriptMessageHandler {
    weak var receiver: WKScriptMessageHandler?

    init(receiver: WKScriptMessageHandler) {
        self.receiver = receiver
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        receiver?.userContentController(userContentController, didReceive: message)
    }
}

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!
    private var pageLoaded = false
#if os(iOS)
    private var iconChangeInProgress = false
#endif
    private var extensionBundleIdentifier: String? {
        Bundle.main.object(forInfoDictionaryKey: "Sche10leExtensionBundleIdentifier") as? String
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(ScriptMessageRelay(receiver: self), name: "controller")
#if os(iOS)
        // The instructions must remain reachable in landscape and with large text.
        webView.scrollView.isScrollEnabled = true
        NotificationCenter.default.addObserver(self, selector: #selector(refreshExtensionState), name: UIApplication.didBecomeActiveNotification, object: nil)
#elseif os(macOS)
        NotificationCenter.default.addObserver(self, selector: #selector(refreshExtensionState), name: NSApplication.didBecomeActiveNotification, object: nil)
#endif
        guard let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let resources = Bundle.main.resourceURL else { return }
        webView.loadFileURL(page, allowingReadAccessTo: resources)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageLoaded = true
        refreshExtensionState()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Only an explicit tap from our bundled page may open the policy externally.
        // Remote pages never load inside the privileged web view.
        if navigationAction.navigationType == .linkActivated,
           navigationAction.sourceFrame.isMainFrame,
           let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
           navigationAction.sourceFrame.request.url?.standardizedFileURL == page.standardizedFileURL,
           let url = navigationAction.request.url,
           url.absoluteString == "https://github.com/hatappo/sche10le/blob/main/PRIVACY.md" {
            decisionHandler(.cancel)
#if os(iOS)
            UIApplication.shared.open(url)
#elseif os(macOS)
            NSWorkspace.shared.open(url)
#endif
            return
        }
        decisionHandler(navigationAction.request.url?.isFileURL == true ? .allow : .cancel)
    }

    @objc private func refreshExtensionState() {
        guard pageLoaded else { return }
#if os(iOS)
        if #available(iOS 18, *) {
            webView.evaluateJavaScript("show('ios', undefined, true)")
        } else {
            webView.evaluateJavaScript("show('ios', undefined, false)")
        }
        sendIconState()
#elseif os(macOS)
        let modernSettings: Bool
        if #available(macOS 13, *) { modernSettings = true } else { modernSettings = false }
        webView.evaluateJavaScript("show('mac', undefined, \(modernSettings))")
        guard let identifier = extensionBundleIdentifier else { return }
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: identifier) { [weak self] state, error in
            guard let state = state, error == nil else { return }
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript("show('mac', \(state.isEnabled), \(modernSettings))")
            }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "controller", message.frameInfo.isMainFrame,
              let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
              message.frameInfo.request.url?.standardizedFileURL == page.standardizedFileURL else { return }
#if os(iOS)
        if message.body as? String == "get-icon-state" {
            sendIconState()
        } else if let request = message.body as? [String: String],
                  request["action"] == "set-icon", let name = request["name"] {
            setAppIcon(name)
        }
#endif
#if os(macOS)
        guard message.body as? String == "open-preferences" else { return }
        guard let identifier = extensionBundleIdentifier else {
            webView.evaluateJavaScript("showSettingsResult(false)")
            return
        }
        SFSafariApplication.showPreferencesForExtension(withIdentifier: identifier) { [weak self] error in
            let succeeded = error == nil
            DispatchQueue.main.async {
                self?.webView.evaluateJavaScript("showSettingsResult(\(succeeded))")
                self?.refreshExtensionState()
            }
        }
#endif
    }

#if os(iOS)
    private func sendIconState(failed: Bool = false) {
        guard pageLoaded else { return }
        let app = UIApplication.shared
        let state: [String: Any] = [
            "supported": app.supportsAlternateIcons,
            "current": app.alternateIconName ?? "AppIcon",
            "busy": iconChangeInProgress,
            "error": failed,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: state),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("showIconState(\(json))")
    }

    private func setAppIcon(_ name: String) {
        let app = UIApplication.shared
        // Accept only assets registered in this app's compiled Info.plist.
        let icons = Bundle.main.object(forInfoDictionaryKey: "CFBundleIcons") as? [String: Any]
        let alternatives = icons?["CFBundleAlternateIcons"] as? [String: Any] ?? [:]
        guard name == "AppIcon" || alternatives[name] != nil,
              app.supportsAlternateIcons, app.applicationState == .active else {
            sendIconState(failed: true)
            return
        }
        guard !iconChangeInProgress else { sendIconState(); return }
        let desired = name == "AppIcon" ? nil : name
        guard app.alternateIconName != desired else { sendIconState(); return }
        iconChangeInProgress = true
        sendIconState()
        app.setAlternateIconName(desired) { [weak self] error in
            DispatchQueue.main.async {
                self?.iconChangeInProgress = false
                self?.sendIconState(failed: error != nil)
            }
        }
    }
#endif
}
