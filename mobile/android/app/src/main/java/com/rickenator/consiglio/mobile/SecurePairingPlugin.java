package com.rickenator.consiglio.mobile;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecurePairing")
public class SecurePairingPlugin extends Plugin {
    private static final String KEY_ALIAS = "consiglio.mobile.pairing.v1";
    private static final String FILE_NAME = "secure-pairing-v1.bin";
    private static final int MAX_FIELD_BYTES = 16 * 1024;

    private File pairingFile() {
        return new File(getContext().getNoBackupFilesDir(), FILE_NAME);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return (SecretKey) store.getKey(KEY_ALIAS, null);

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .build());
        return generator.generateKey();
    }

    private byte[] payload(String endpoint, String token) throws Exception {
        byte[] endpointBytes = endpoint.getBytes(StandardCharsets.UTF_8);
        byte[] tokenBytes = token.getBytes(StandardCharsets.UTF_8);
        if (endpointBytes.length == 0 || endpointBytes.length > MAX_FIELD_BYTES || tokenBytes.length < 32 || tokenBytes.length > MAX_FIELD_BYTES) {
            throw new IllegalArgumentException("Pairing credentials are invalid");
        }
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        try (DataOutputStream output = new DataOutputStream(bytes)) {
            output.writeInt(endpointBytes.length);
            output.write(endpointBytes);
            output.writeInt(tokenBytes.length);
            output.write(tokenBytes);
        }
        return bytes.toByteArray();
    }

    @PluginMethod
    public void save(PluginCall call) {
        String endpoint = call.getString("endpoint", "").trim();
        String token = call.getString("token", "").trim();
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] ciphertext = cipher.doFinal(payload(endpoint, token));

            File target = pairingFile();
            File temporary = new File(target.getParentFile(), FILE_NAME + ".tmp");
            try (DataOutputStream output = new DataOutputStream(new FileOutputStream(temporary))) {
                output.writeInt(cipher.getIV().length);
                output.write(cipher.getIV());
                output.writeInt(ciphertext.length);
                output.write(ciphertext);
            }
            temporary.setReadable(false, false);
            temporary.setWritable(false, false);
            temporary.setReadable(true, true);
            temporary.setWritable(true, true);
            if (!temporary.renameTo(target)) {
                temporary.delete();
                throw new IllegalStateException("Could not commit secure pairing");
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not protect this pairing with Android Keystore");
        }
    }

    @PluginMethod
    public void load(PluginCall call) {
        File target = pairingFile();
        if (!target.isFile()) {
            call.resolve(new JSObject());
            return;
        }
        try (DataInputStream input = new DataInputStream(new FileInputStream(target))) {
            int ivLength = input.readInt();
            if (ivLength < 12 || ivLength > 32) throw new IllegalStateException("Invalid pairing nonce");
            byte[] iv = new byte[ivLength];
            input.readFully(iv);
            int ciphertextLength = input.readInt();
            if (ciphertextLength < 32 || ciphertextLength > MAX_FIELD_BYTES * 2 + 128) throw new IllegalStateException("Invalid pairing payload");
            byte[] ciphertext = new byte[ciphertextLength];
            input.readFully(ciphertext);
            if (input.read() != -1) throw new IllegalStateException("Unexpected pairing data");

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
            try (DataInputStream payload = new DataInputStream(new java.io.ByteArrayInputStream(cipher.doFinal(ciphertext)))) {
                int endpointLength = payload.readInt();
                if (endpointLength < 1 || endpointLength > MAX_FIELD_BYTES) throw new IllegalStateException("Invalid endpoint");
                byte[] endpoint = new byte[endpointLength];
                payload.readFully(endpoint);
                int tokenLength = payload.readInt();
                if (tokenLength < 32 || tokenLength > MAX_FIELD_BYTES) throw new IllegalStateException("Invalid token");
                byte[] token = new byte[tokenLength];
                payload.readFully(token);
                if (payload.read() != -1) throw new IllegalStateException("Unexpected pairing payload");
                JSObject result = new JSObject();
                result.put("endpoint", new String(endpoint, StandardCharsets.UTF_8));
                result.put("token", new String(token, StandardCharsets.UTF_8));
                call.resolve(result);
            }
        } catch (Exception error) {
            target.delete();
            call.reject("The saved pairing could not be unlocked and was removed");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        try {
            pairingFile().delete();
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not remove the saved pairing");
        }
    }
}
