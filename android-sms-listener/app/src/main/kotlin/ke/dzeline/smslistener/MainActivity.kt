package ke.dzeline.smslistener

import android.content.ComponentName
import android.content.Intent
import android.content.SharedPreferences
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var tvStatus: TextView
    private lateinit var etWebhookUrl: EditText
    private lateinit var etApiKey: EditText
    private lateinit var etSecret: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs        = Webhook.prefs(this)
        tvStatus     = findViewById(R.id.tvStatus)
        etWebhookUrl = findViewById(R.id.etWebhookUrl)
        etApiKey     = findViewById(R.id.etApiKey)
        etSecret     = findViewById(R.id.etSecret)

        // Pre-fill saved values
        etWebhookUrl.setText(Webhook.baseUrl(prefs))
        etApiKey.setText(Webhook.apiKey(prefs))
        etSecret.setText(Webhook.secret(prefs))

        findViewById<Button>(R.id.btnNotificationAccess).setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        findViewById<Button>(R.id.btnSave).setOnClickListener { save() }
        findViewById<Button>(R.id.btnTest).setOnClickListener { sendTestWebhook() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun save() {
        val url    = etWebhookUrl.text.toString().trim()
        val apiKey = etApiKey.text.toString().trim()
        val secret = etSecret.text.toString().trim()

        if (url.isEmpty()) {
            toast("Enter a webhook URL first")
            return
        }
        // The API key now travels in the query string, so plain HTTP would put
        // it on the wire in the clear. Android blocks cleartext at this target
        // SDK anyway — catching it here turns an opaque "Network error" into
        // something the person configuring the phone can act on.
        if (!url.startsWith("https://", ignoreCase = true)) {
            toast("Webhook URL must start with https://")
            return
        }
        if (apiKey.isEmpty()) {
            toast("Enter the shop's API key — the backend needs it to know which shop this is")
            return
        }
        // Pasting the ready-made URL from the docs is an easy mistake; keeping
        // the key in its own field is what lets the app build the URL correctly.
        if (url.contains("key=", ignoreCase = true)) {
            toast("Remove ?key= from the URL — put the key in the API Key field instead")
            return
        }

        Webhook.save(prefs, url, apiKey, secret)
        toast("Settings saved")
    }

    private fun refreshStatus() {
        val granted = isNotificationAccessGranted()
        val configured = Webhook.endpoint(prefs) != null

        tvStatus.text = when {
            !granted   -> "⚠  Notification access not granted.\nTap the button below, find \"Dzeline SMS Listener\" and enable it."
            !configured -> "⚠  Notification access granted, but the webhook URL and API key are not saved yet."
            else        -> "✓  Notification access granted — listening for M-Pesa"
        }
        // ContextCompat, not getColor() — that overload needs API 23 and
        // minSdk here is 21, which Android lint treats as fatal on a release
        // build. Nobody had hit it because the build never ran.
        tvStatus.setTextColor(
            ContextCompat.getColor(
                this,
                if (granted && configured) android.R.color.holo_green_dark
                else                       android.R.color.holo_orange_dark,
            ),
        )
    }

    private fun isNotificationAccessGranted(): Boolean {
        val flat = Settings.Secure.getString(
            contentResolver, "enabled_notification_listeners",
        ) ?: return false
        val cn = ComponentName(this, MpesaListenerService::class.java).flattenToString()
        return flat.contains(cn)
    }

    private fun sendTestWebhook() {
        if (Webhook.endpoint(prefs) == null) {
            toast("Save a webhook URL and API key first")
            return
        }

        // Realistic test SMS. Kept in the Safaricom "Ksh" spelling rather than
        // "KES" so the test exercises the same parse path as real traffic — a
        // test that only passes on a format the network does not send is worse
        // than no test.
        val testBody = "QA12BC34DE Confirmed. You have received Ksh250.00 " +
                       "from TEST DEMO 0712000000 on 28/5/26 at 12:00 PM. " +
                       "New M-Pesa balance is Ksh1,000.00. Transaction cost, Ksh0.00."

        Thread {
            try {
                val code = Webhook.post(prefs, testBody)
                runOnUiThread {
                    when {
                        code in 200..299 ->
                            toast("Test sent ✓  (HTTP $code) — check /sms/verified-codes on your backend")
                        code == 401 ->
                            toast("HTTP 401 — the API key or the webhook secret is wrong")
                        else ->
                            toast("Backend returned HTTP $code")
                    }
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Network error: ${e.message}") }
            }
        }.start()
    }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
