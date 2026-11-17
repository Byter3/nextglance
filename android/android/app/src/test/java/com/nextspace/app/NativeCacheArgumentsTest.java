package com.nextspace.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.nio.file.Files;
import org.junit.Test;
import static org.junit.Assert.*;

/** Exercises the real JSON/Capacitor argument boundary, not manually typed longs. */
public class NativeCacheArgumentsTest {
    private PluginCall call(String json) throws Exception {
        return new PluginCall(null, "NextcloudSso", "fixture", "cacheFile", new JSObject(json));
    }
    private NativeCacheArguments read(String size, String offset, String length, String epoch) throws Exception {
        return NativeCacheArguments.from(call("{\"operation\":\"read\",\"size\":" + size + ",\"offset\":" + offset + ",\"length\":" + length + ",\"ownerEpoch\":" + epoch + "}"));
    }

    @Test public void actualPluginCallSmallIntegersPreviouslyBecameMissingLongs() throws Exception {
        PluginCall input = call("{\"operation\":\"read\",\"size\":3,\"offset\":0,\"length\":3,\"ownerEpoch\":1794590000000}");
        assertTrue(input.getData().opt("size") instanceof Integer);
        assertEquals(Long.valueOf(-1), input.getLong("size", -1L));
        assertEquals(Long.valueOf(-1), input.getLong("offset", -1L));
        NativeCacheArguments value = NativeCacheArguments.from(input);
        assertEquals(3, value.size()); assertEquals(0, value.offset()); assertEquals(3, value.length());
        assertEquals(1794590000000L, value.ownerEpoch());
        assertEquals(3, read("3.0", "0.0", "3.0", "1").size());
        assertEquals(9007199254740991L, read("52428800", "52428800", "262144", "9007199254740991").ownerEpoch());
    }

    @Test public void invalidNumericValuesFailBeforeNativeFileAccess() throws Exception {
        for (String invalid : new String[]{"-1", "0.5", "3.000000000000000001", "52428801", "\"3\"", "true", "null", "{}", "[]"}) {
            assertThrows(NativeLoginFlow.Failure.class, () -> read(invalid, "0", "1", "1"));
            assertThrows(NativeLoginFlow.Failure.class, () -> read("3", invalid, "1", "1"));
        }
        assertThrows(NativeLoginFlow.Failure.class, () -> read("3", "0", "262145", "1"));
        assertThrows(NativeLoginFlow.Failure.class, () -> read("3", "0", "1", "9007199254740992"));
        assertThrows(NativeLoginFlow.Failure.class, () -> NativeCacheArguments.from(call("{\"operation\":\"beginWrite\",\"ownerEpoch\":1}")));
        for (double invalid : new double[]{Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY})
            assertThrows(NativeLoginFlow.Failure.class, () -> NativeCacheArguments.number(invalid, NativeCacheFile.MAX));
    }

    @Test public void parsedPluginArgumentsRoundtripExistingPrivateFilesWithoutReset() throws Exception {
        var root = Files.createTempDirectory("cache-number-fixture").toFile();
        var cache = new NativeCacheFile(root, (from, to) -> Files.move(from.toPath(), to.toPath(), java.nio.file.StandardCopyOption.ATOMIC_MOVE, java.nio.file.StandardCopyOption.REPLACE_EXISTING));
        String path = "cache/" + "a".repeat(64) + ".0.json", owner = "b".repeat(32);
        var begin = NativeCacheArguments.from(call("{\"operation\":\"beginWrite\",\"size\":3,\"ownerEpoch\":1}"));
        cache.owner(owner, begin.ownerEpoch());
        NativeCacheFile.Guard guard = () -> cache.checkOwner(owner, begin.ownerEpoch());
        String token = cache.begin(path, begin.size(), 0, owner, guard);
        var append = NativeCacheArguments.from(call("{\"operation\":\"append\",\"offset\":0,\"ownerEpoch\":1}"));
        cache.append(path, token, 0, owner, append.offset(), new byte[]{1, 2, 3}, guard);
        cache.commit(path, token, 0, owner, guard);
        var value = read("3", "0", "3", "1");
        assertArrayEquals(new byte[]{1, 2, 3}, cache.read(path, value.offset(), value.length(), value.size(), cache.revision(path), guard));
        assertThrows(NativeLoginFlow.Failure.class, () -> read("3", "-1", "3", "1"));
        assertEquals(Long.valueOf(3), cache.size(path));
    }
}
