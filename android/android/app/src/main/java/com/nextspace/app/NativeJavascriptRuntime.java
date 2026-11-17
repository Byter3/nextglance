package com.nextspace.app;

import android.content.Context;
import androidx.annotation.RequiresApi;
import androidx.javascriptengine.JavaScriptSandbox;
import androidx.javascriptengine.JavaScriptIsolate;
import androidx.javascriptengine.IsolateStartupParameters;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** All API26-only engine references live here. The API24 host calls this only after its SDK gate. */
@RequiresApi(26)
final class NativeJavascriptRuntime implements AutoCloseable {
    interface Remaining {long get() throws Exception;}
    private final JavaScriptSandbox sandbox;
    private final JavaScriptIsolate isolate;
    static boolean supported(){return JavaScriptSandbox.isSupported();}
    NativeJavascriptRuntime(Context context,Remaining remaining,int maxReturn)throws Exception{
        var connection=JavaScriptSandbox.createConnectedInstanceAsync(context);
        try{sandbox=connection.get(remaining.get(),TimeUnit.MILLISECONDS);}catch(Exception error){connection.cancel(true);throw error;}
        try{
            for(String feature:List.of(JavaScriptSandbox.JS_FEATURE_PROMISE_RETURN,JavaScriptSandbox.JS_FEATURE_PROVIDE_CONSUME_ARRAY_BUFFER,JavaScriptSandbox.JS_FEATURE_EVALUATE_WITHOUT_TRANSACTION_LIMIT,JavaScriptSandbox.JS_FEATURE_ISOLATE_MAX_HEAP_SIZE))if(!sandbox.isFeatureSupported(feature))throw NativeSyncPolicy.failure("UNAVAILABLE","The Android JavaScript provider cannot project read data in the background.");
            IsolateStartupParameters settings=new IsolateStartupParameters();settings.setMaxHeapSizeBytes(256L*1024*1024);settings.setMaxEvaluationReturnSizeBytes(maxReturn);isolate=sandbox.createIsolate(settings);
        }catch(Exception error){sandbox.close();throw error;}
    }
    String evaluate(String script,byte[] payload,Remaining remaining)throws Exception{
        isolate.evaluateJavaScriptAsync(script).get(remaining.get(),TimeUnit.MILLISECONDS);
        isolate.provideNamedData("snapshot",payload);
        return isolate.evaluateJavaScriptAsync("android.consumeNamedDataAsArrayBuffer('snapshot').then(bytes => nextglanceBackground(JSON.parse(new TextDecoder().decode(bytes)))).then(value => JSON.stringify(value))").get(remaining.get(),TimeUnit.MILLISECONDS);
    }
    @Override public void close(){isolate.close();sandbox.close();}
}
