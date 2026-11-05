package com.bughunter.mobile

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.CookieHandler
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID

data class ApiResponse(
    val status: Int,
    val body: String
) {
    val ok: Boolean get() = status in 200..299
    fun jsonObj(): JSONObject? = try { JSONObject(body) } catch (_: Exception) { null }
    fun jsonArr(): JSONArray? = try { JSONArray(body) } catch (_: Exception) { null }
}

class MobileHttpClient(
    var baseUrl: String
) {
    private val headers = mutableMapOf<String, String>(
        "X-Guest" to "guest-" + UUID.randomUUID().toString().take(12)
    )

    init {
        if (CookieHandler.getDefault() == null) {
            CookieHandler.setDefault(CookieManager(null, CookiePolicy.ACCEPT_ALL))
        }
    }

    fun setHeader(name: String, value: String?) {
        if (value == null) headers.remove(name) else headers[name] = value
    }

    suspend fun request(
        method: String,
        path: String,
        jsonBody: JSONObject? = null
    ): ApiResponse = withContext(Dispatchers.IO) {
        val fullUrl = baseUrl.trimEnd('/') + "/" + path.trimStart('/')
        try {
            val conn = (URL(fullUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Accept", "application/json")
                for ((k, v) in headers) {
                    setRequestProperty(k, v)
                }
                if (jsonBody != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            if (jsonBody != null) {
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { writer ->
                    writer.write(jsonBody.toString())
                }
            }
            val code = conn.responseCode
            val stream = if (code in 200..399) conn.inputStream else conn.errorStream
            val text = if (stream != null) {
                BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
            } else ""
            Log.d("BugHunterNet", "$method $path -> $code (${text.take(160)})")
            ApiResponse(code, text)
        } catch (e: Exception) {
            Log.e("BugHunterNet", "$method $path failed: ${e.message}", e)
            ApiResponse(0, JSONObject(mapOf("error" to (e.message ?: "Network error"))).toString())
        }
    }
}
