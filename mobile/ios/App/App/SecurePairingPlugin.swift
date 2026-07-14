import Foundation
import Security
import Capacitor

@objc(SecurePairingPlugin)
public class SecurePairingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecurePairingPlugin"
    public let jsName = "SecurePairing"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private var service: String {
        return (Bundle.main.bundleIdentifier ?? "com.rickenator.consiglio.mobile") + ".pairing.v1"
    }

    private var query: [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "desktop-bridge"
        ]
    }

    @objc func save(_ call: CAPPluginCall) {
        guard let endpoint = call.getString("endpoint")?.trimmingCharacters(in: .whitespacesAndNewlines),
              let token = call.getString("token")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !endpoint.isEmpty, token.count >= 32 else {
            return call.reject("Pairing credentials are invalid")
        }

        do {
            let payload = try JSONSerialization.data(withJSONObject: ["endpoint": endpoint, "token": token])
            let values: [String: Any] = [
                kSecValueData as String: payload,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            ]
            let updateStatus = SecItemUpdate(query as CFDictionary, values as CFDictionary)
            if updateStatus == errSecItemNotFound {
                var attributes = query
                values.forEach { attributes[$0.key] = $0.value }
                guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
                    return call.reject("Could not protect this pairing with iOS Keychain")
                }
            } else if updateStatus != errSecSuccess {
                return call.reject("Could not protect this pairing with iOS Keychain")
            }
            call.resolve()
        } catch {
            call.reject("Could not encode the pairing for secure storage")
        }
    }

    @objc func load(_ call: CAPPluginCall) {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(request as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve()
            return
        }
        let decoded = (item as? Data).flatMap { try? JSONSerialization.jsonObject(with: $0) }
        guard status == errSecSuccess,
              let payload = decoded as? [String: String],
              let endpoint = payload["endpoint"],
              let token = payload["token"],
              !endpoint.isEmpty, token.count >= 32 else {
            SecItemDelete(query as CFDictionary)
            call.reject("The saved pairing could not be unlocked and was removed")
            return
        }
        call.resolve(["endpoint": endpoint, "token": token])
    }

    @objc func clear(_ call: CAPPluginCall) {
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("Could not remove the saved pairing")
        }
    }
}
