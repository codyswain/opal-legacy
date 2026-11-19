import CryptoKit
import Foundation
import LocalAuthentication
import Security

// Opal's key for allowing Auto's sends, the laptop's copy of the phone's SendKey.swift.
//
// A P-256 key made in this Mac's Secure Enclave. It never leaves the Enclave and signs only after
// Touch ID, every time; a fingerprint added later makes it unusable (.biometryCurrentSet). What is
// kept on disk is the Enclave's encrypted handle for the key, which works on this Mac alone, so no
// keychain item, entitlement or provisioning is needed and an ad-hoc signature is enough.
//
//   opal-signer pubkey                  prints the public key line, making the key if there is none
//   opal-signer sign --reason "<text>"  signs the bytes on stdin, after Touch ID; prints the base64 DER signature
//
// Exit 0 with the answer on stdout; otherwise 2 when he cancelled, 1 for anything else, with one
// line on stderr.

/// The key's handle. OPAL_SIGNER_KEY names another file, for trying the helper without touching his key.
let keyFile: URL = {
    if let path = ProcessInfo.processInfo.environment["OPAL_SIGNER_KEY"], !path.isEmpty {
        return URL(fileURLWithPath: path)
    }
    return FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Opal/auto-send-key.blob")
}()

func fail(_ message: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func short(_ error: Error) -> String {
    let e = error as NSError
    return "\(e.domain) \(e.code)"
}

/// Whether he backed out of Touch ID, as opposed to it failing.
func backedOut(_ error: Error) -> Bool {
    let e = error as NSError
    let quiet: [LAError.Code] = [.userCancel, .appCancel, .systemCancel]
    if e.domain == LAError.errorDomain, quiet.contains(where: { $0.rawValue == e.code }) { return true }
    if let under = e.userInfo[NSUnderlyingErrorKey] as? NSError { return backedOut(under) }
    return false
}

func stored() -> Data? {
    try? Data(contentsOf: keyFile)
}

func store(_ blob: Data) throws {
    let folder = keyFile.deletingLastPathComponent()
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let tmp = folder.appendingPathComponent(".\(keyFile.lastPathComponent).tmp")
    FileManager.default.createFile(atPath: tmp.path, contents: nil, attributes: [.posixPermissions: 0o600])
    try blob.write(to: tmp)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: tmp.path)
    guard rename(tmp.path, keyFile.path) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
}

func make() throws -> SecureEnclave.P256.Signing.PrivateKey {
    guard SecureEnclave.isAvailable else { fail("This Mac has no Secure Enclave.") }
    var problem: Unmanaged<CFError>?
    // Usable only on this Mac, only while it is unlocked, and each use asks for a fingerprint enrolled now.
    guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                                                       [.privateKeyUsage, .biometryCurrentSet], &problem) else {
        fail("Could not set up the key (\(problem.map { String(describing: $0.takeRetainedValue()) } ?? "access control")).")
    }
    let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
    try store(key.dataRepresentation)
    return key
}

func pubkey() {
    do {
        let key: SecureEnclave.P256.Signing.PrivateKey
        if let blob = stored() {
            // Reading the public half asks for no fingerprint.
            key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob)
        } else {
            key = try make()
        }
        print(key.publicKey.x963Representation.base64EncodedString())
    } catch {
        fail("Could not read this Mac's key (\(short(error))).")
    }
}

func sign(reason: String) {
    guard let blob = stored() else { fail("This Mac has no key for sending. Pair it first.") }
    let message = FileHandle.standardInput.readDataToEndOfFile()
    guard !message.isEmpty else { fail("Nothing to sign.") }
    do {
        // A new context each time, with no reuse: Touch ID asks for every signature.
        let context = LAContext()
        context.localizedReason = reason
        context.touchIDAuthenticationAllowableReuseDuration = 0
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: blob, authenticationContext: context)
        print(try key.signature(for: message).derRepresentation.base64EncodedString())
    } catch {
        if backedOut(error) { fail("Not confirmed. Nothing was sent.", code: 2) }
        fail("This Mac could not sign the send (\(short(error))). Nothing was sent.")
    }
}

let args = Array(CommandLine.arguments.dropFirst())
switch args.first {
case "pubkey":
    pubkey()
case "sign":
    guard args.count == 3, args[1] == "--reason", !args[2].isEmpty else { fail("usage: opal-signer sign --reason <text>") }
    sign(reason: args[2])
default:
    fail("usage: opal-signer pubkey | sign --reason <text>")
}
