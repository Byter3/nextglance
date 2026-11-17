package com.nextspace.app;

import com.getcapacitor.PluginCall;

/** JSON numbers are validated by value, not Integer/Long representation. */
record NativeCacheArguments(long ownerEpoch, long offset, int length, long size) {
    private static final long MAX_SAFE_INTEGER = 9007199254740991L;

    static NativeCacheArguments from(PluginCall call) throws NativeLoginFlow.Failure {
        String operation = call.getString("operation", "");
        long ownerEpoch = number(call.getData().opt("ownerEpoch"), MAX_SAFE_INTEGER);
        long offset = 0, size = 0;
        int length = 0;
        if (operation.equals("read") || operation.equals("append")) offset = number(call.getData().opt("offset"), NativeCacheFile.MAX);
        if (operation.equals("read") || operation.equals("beginWrite")) size = number(call.getData().opt("size"), NativeCacheFile.MAX);
        if (operation.equals("read")) length = (int) number(call.getData().opt("length"), NativeCacheFile.CHUNK);
        return new NativeCacheArguments(ownerEpoch, offset, length, size);
    }

    static long number(Object value, long maximum) throws NativeLoginFlow.Failure {
        if (!(value instanceof Number number)) throw invalid();
        double numeric = number.doubleValue();
        if (!Double.isFinite(numeric) || numeric < 0 || numeric > maximum || numeric != Math.rint(numeric)) throw invalid();
        try {
            long integral = new java.math.BigDecimal(number.toString()).longValueExact();
            if (integral < 0 || integral > maximum) throw invalid();
            return integral;
        } catch (ArithmeticException | NumberFormatException ignored) { throw invalid(); }
    }

    private static NativeLoginFlow.Failure invalid() {
        return new NativeLoginFlow.Failure("CACHE_FORMAT", "Invalid numeric private cache argument.");
    }
}
