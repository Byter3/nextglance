package com.nextspace.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.ByteArrayInputStream;
public class NativeMultipartTest {
    @Test public void multipartPreservesBytesAndNativeFields()throws Exception{
        byte[] bytes={0,1,2,(byte)255};try(var stream=NativeMultipart.stream("example.bin",new ByteArrayInputStream(bytes),4,"NextGlance-fixture-boundary")){
            String text=new String(stream.readAllBytes(),java.nio.charset.StandardCharsets.ISO_8859_1);assertTrue(text.contains("name=\"type\"\r\n\r\nfile"));assertTrue(text.contains("filename=\"example.bin\""));assertTrue(text.contains(new String(bytes,java.nio.charset.StandardCharsets.ISO_8859_1)));
        }
    }
    @Test public void changedFileSizeAndUnsafeNamesAreRejected()throws Exception{
        for(long size:new long[]{0,2})try(var stream=NativeMultipart.stream("file.bin",new ByteArrayInputStream(new byte[]{1}),size,"NextGlance-fixture-boundary")){try{stream.readAllBytes();fail();}catch(java.io.IOException expected){}}
        try{NativeMultipart.name("../file");fail();}catch(NativeLoginFlow.Failure expected){assertEquals("VALIDATION",expected.code);}
    }
}
