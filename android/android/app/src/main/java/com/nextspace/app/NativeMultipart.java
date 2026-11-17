package com.nextspace.app;

import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.io.SequenceInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;

final class NativeMultipart {
    static final long MAX=20L*1024*1024;
    static String name(String value)throws Exception{
        if(value==null||value.isBlank()||value.length()>255||value.chars().anyMatch(c->c<32||c==127)||value.contains("/")||value.contains("\\"))throw new NativeLoginFlow.Failure("VALIDATION","Choose a file with a valid name.");return value.replace('"','_');
    }
    static InputStream stream(String name,InputStream file,long size,String boundary)throws Exception{
        name=name(name);if(size<0||size>MAX)throw new NativeLoginFlow.Failure("LIMIT","Choose a file up to 20 MiB.");
        if(!boundary.matches("[a-zA-Z0-9-]{16,80}"))throw new NativeLoginFlow.Failure("VALIDATION","Invalid upload boundary.");
        String prefix="--"+boundary+"\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\nfile\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"data\"\r\n\r\n"+name+"\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"file\"; filename=\""+name+"\"\r\nContent-Type: application/octet-stream\r\n\r\n";
        InputStream bounded=new InputStream(){long read;boolean ended;
            public int read()throws java.io.IOException{byte[] one=new byte[1];int n=read(one,0,1);return n<0?-1:one[0]&255;}
            public int read(byte[] bytes,int offset,int length)throws java.io.IOException{if(length==0)return 0;if(ended)return -1;int n=file.read(bytes,offset,(int)Math.min(length,Math.max(1,size-read+1)));if(n<0){ended=true;if(read!=size)throw new java.io.IOException("Selected file changed size.");return -1;}read+=n;if(read>size||read>MAX)throw new java.io.IOException("Selected file exceeds its declared size.");return n;}
            public void close()throws java.io.IOException{file.close();}
        };
        return new SequenceInputStream(Collections.enumeration(List.of(new ByteArrayInputStream(prefix.getBytes(StandardCharsets.UTF_8)),bounded,new ByteArrayInputStream(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8)))));
    }
}
