package com.nextspace.app;

import java.util.Map;

/** Pure publication fence, including acknowledged-edit slot revisions and account/lifecycle guard. */
final class NativeReadGeneration {
    interface Revision {String read(String path) throws Exception;}
    interface Commit {void run() throws Exception;}
    static void publish(Map<String,String> expected, Revision revisions, NativeResourceCache.Guard guard, Commit commit) throws Exception {
        guard.check();
        for(var entry:expected.entrySet()) {
            if(!entry.getValue().equals(revisions.read(entry.getKey()))) throw NativeSyncPolicy.failure("CANCELLED","Saved data changed during background projection.");
        }
        guard.check();commit.run();
    }
}
