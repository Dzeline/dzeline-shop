package ke.dzeline.smslistener

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * Shared webhook configuration and delivery.
 *
 * Both the listener service and the "Send Test Webhook" button post the same
 * shape to the same endpoint. They used to build the request separately, which
 * is how the test could pass while real delivery was misconfigured — so the URL
 * assembly and the POST both live here now.
 */
object Webhook {

    const val PREFS = "dzeline_sms"

    private const val KEY_URL    = "webhook_url"
    private const val KEY_SECRET = "webhook_secret"
    private const val KEY_API    = "api_key"

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun baseUrl(prefs: SharedPreferences): String = prefs.getString(KEY_URL, "").orEmpty().trim()
    fun apiKey(prefs: SharedPreferences): String = prefs.getString(KEY_API, "").orEmpty().trim()
    fun secret(prefs: SharedPreferences): String = prefs.getString(KEY_SECRET, "").orEmpty().trim()

    fun save(prefs: SharedPreferences, url: String, apiKey: String, secret: String) {
        prefs.edit()
            .putString(KEY_URL, url.trim())
            .putString(KEY_API, apiKey.trim())
            .putString(KEY_SECRET, secret.trim())
            .apply()
    }

    /**
     * The full endpoint, with the shop's API key appended as `?key=`.
     *
     * The backend requires it: without a key it cannot tell which shop a code
     * belongs to, and codes that used to be stored unscoped were readable by
     * every other shop on the deployment. Returns null when either half is
     * missing, so callers fail loudly instead of posting somewhere useless.
     */
    fun endpoint(prefs: SharedPreferences): String? {
        val base = baseUrl(prefs)
        val key  = apiKey(prefs)
        if (base.isBlank() || key.isBlank()) return null
        val separator = if (base.contains("?")) "&" else "?"
        return base + separator + "key=" + URLEncoder.encode(key, "UTF-8")
    }

    /** Payload the backend's /sms/webhook expects. */
    fun payload(smsBody: String): ByteArray =
        JSONObject().apply {
            put("address", "MPESA")
            put("body", smsBody)
            put("date", System.currentTimeMillis())
        }.toString().toByteArray()

    /**
     * POST a message body to the configured endpoint. Blocking — call it off
     * the main thread. Returns the HTTP status code.
     */
    fun post(prefs: SharedPreferences, smsBody: String): Int {
        val endpoint = endpoint(prefs) ?: throw IllegalStateException("Webhook URL or API key not set")
        val secret = secret(prefs)

        val conn = URL(endpoint).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 15_000
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            if (secret.isNotBlank()) conn.setRequestProperty("X-SMS-Secret", secret)

            conn.outputStream.use { it.write(payload(smsBody)) }
            return conn.responseCode
        } finally {
            conn.disconnect()
        }
    }
}
