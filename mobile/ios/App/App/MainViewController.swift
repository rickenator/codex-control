import Capacitor

@objc(MainViewController)
final class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(SecurePairingPlugin())
    }
}
