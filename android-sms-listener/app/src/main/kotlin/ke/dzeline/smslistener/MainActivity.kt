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
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class MainActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private lateinit var tvStatus: TextView
    private lateinit var etWebhookUrl: EditText
    private lateinit var etSecret: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs        = getSharedPreferences("dzeline_sms", MODE_PRIVATE)
        tvStatus     = findViewById(R.id.tvStatus)
        etWebhookUrl = findViewById(R.id.etWebhookUrl)
        etSecret     = findViewById(R.id.etSecret)

        // Pre-fill saved values
        etWebhookUrl.setText(prefs.getString("webhook_url", ""))
        etSecret.setText(prefs.getString("webhook_secret", ""))

        findViewById<Button>(R.id.btnNotificationAccess).setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        findViewById<Button>(R.id.btnSave).setOnClickListener {
            val url    = etWebhookUrl.text.toString().trim()
            val secret = etSecret.text.toString().trim()
            if (url.isEmpty()) {
                toast("Enter a webhook URL first")
                return@setOnClickListener
            }
            prefs.edit()
                .putString("webhook_url",     url)
                .putString("webhook_secret",  secret)
                .apply()
            toast("Settings saved")
        }

        findViewById<Button>(R.id.btnTest).setOnClickListener { sendTestWebhook() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun refreshStatus() {
        val granted = isNotificationAccessGranted()
        tvStatus.text = if (granted)
            "✓  Notification access granted — listening for M-Pesa"
        else
            "⚠  Notification access not granted.\nTap the button below, find \"Dzeline SMS Listener\" and enable it."
        tvStatus.setTextColor(
            if (granted) getColor(android.R.color.holo_green_dark)
            else         getColor(android.R.color.holo_orange_dark),
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
        val url    = prefs.getString("webhook_url",    "").orEmpty()
        val secret = prefs.getString("webhook_secret", "").orEmpty()

        if (url.isEmpty()) {
            toast("Save a webhook URL first")
            return
        }

        // Realistic-looking test SMS that the backend parser will accept
        val testBody = "QA12BC34DE confirmed. You have received KES 250.00 " +
                       "from TEST DEMO 0712000000 on 28/5/26 at 12:00 PM. " +
                       "New M-Pesa balance is KES 1,000.00. Transaction cost, Ksh 0.00."

        Thread {
            try {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.requestMethod  = "POST"
                conn.connectTimeout = 15_000
                conn.readTimeout    = 15_000
                conn.doOutput       = true
                conn.setRequestProperty("Content-Type", "application/json")
                if (secret.isNotBlank()) conn.setRequestProperty("X-SMS-Secret", secret)

                val payload = JSONObject().apply {
                    put("address", "MPESA")
                    put("body",    testBody)
                    put("date",    System.currentTimeMillis())
                }.toString().toByteArray()

                conn.outputStream.use { it.write(payload) }
                val code = conn.responseCode
                conn.disconnect()

                runOnUiThread {
                    if (code in 200..299)
                        toast("Test sent ✓  (HTTP $code) — check /sms/verified-codes on your backend")
                    else
                        toast("Backend returned HTTP $code — check SMS_WEBHOOK_SECRET")
                }
            } catch (e: Exception) {
                runOnUiThread { toast("Network error: ${e.message}") }
            }
        }.start()
    }

    private fun toast(msg: String) =
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
}
