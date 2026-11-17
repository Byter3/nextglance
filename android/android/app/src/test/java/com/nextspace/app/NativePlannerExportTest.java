package com.nextspace.app;

import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

public class NativePlannerExportTest {
    private final String document = "{\"schemaVersion\":2,\"id\":\"workspace\",\"name\":\"My planner\",\"spaces\":[],\"projects\":[],\"relations\":[],\"plans\":[],\"identities\":[],\"properties\":{},\"updatedAt\":\"2030-01-01T00:00:00Z\"}";
    @Test public void acceptsOnlyBoundedPlannerMetadata() throws Exception {
        assertEquals(document, NativePlannerExport.checked(document));
        for (String invalid : new String[]{null, "[]", "{}", document + " {}", document.replace("\"schemaVersion\":2", "\"schemaVersion\":\"2\""), document.replace("\"schemaVersion\":2", "\"schemaVersion\":1"), document.replace("\"properties\":{}", "\"properties\":{},\"records\":[]"), document.replace("\"properties\":{}", "\"properties\":{},\"credentials\":{}"), "x".repeat(8*1024*1024+1)}) assertThrows(Exception.class, () -> NativePlannerExport.checked(invalid));
    }
    @Test public void writesExactMetadataAndSurfacesStorageFailure() throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        NativePlannerExport.write(output, document);
        assertEquals(document, output.toString(StandardCharsets.UTF_8));
        assertThrows(IOException.class, () -> NativePlannerExport.write(new OutputStream() { public void write(int value) throws IOException { throw new IOException("Destination full"); } }, document));
        assertThrows(IOException.class, () -> NativePlannerExport.write(null, document));
    }
}
