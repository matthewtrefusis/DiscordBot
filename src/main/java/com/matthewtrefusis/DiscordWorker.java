package com.matthewtrefusis;

import org.teavm.interop.Export;

public class DiscordWorker {

    public static void main(String[] args) {
        // Entry point required by TeaVM static analysis
    }

    @Export(name = "handleRequest")
    public static int handleRequest(int command) {
        switch (command) {
            case 1:
                return 1;
            case 2:
                return 2;
            case 3:
                return 3;
            default:
                return 0;
        }
    }
}