package com.matthewtrefusis;

import org.teavm.jso.JSBody;
import org.teavm.jso.JSObject;
import org.teavm.interop.Export;

public class DiscordWorker {

    public static void main(String[] args) {
        // Entry point required by TeaVM static analysis
    }

    @Export(name = "handleRequest")
    public static String handleRequest(String body, String signature, String timestamp, String publicKey) {
        try {
            if (body != null && (body.contains("\"name\":\"ping\"") || body.contains("\"name\": \"ping\""))) {
                return "{\"type\": 4, \"data\": {\"content\": \"🏓 Pong!\"}}";
            }
            return "{\"type\": 4, \"data\": {\"content\": \"Unknown command received.\"}}";
        } catch (Throwable t) {
            return "{\"type\": 4, \"data\": {\"content\": \"Java Exception: " + t.getMessage() + "\"}}";
        }
    }
}