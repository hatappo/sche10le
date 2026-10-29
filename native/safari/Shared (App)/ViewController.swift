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
        // This app displays bundled instructions only, never a remote web page.
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
#if os(macOS)
        guard message.name == "controller", message.body as? String == "open-preferences",
              message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true else { return }
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
}
