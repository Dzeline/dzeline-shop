package ke.dzeline.smslistener

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log

class MpesaListenerService : NotificationListenerService() {

    companion object {
        private const val TAG = "DzelineSMS"

        // M-Pesa confirmation codes are exactly 10 uppercase alphanumeric chars
        // followed by " confirmed." — this is Safaricom's stable format since 2017.
        private val MPESA_CONFIRM = Regex(
            """^[A-Z0-9]{10}\s+confirmed\.""",
            RegexOption.IGNORE_CASE,
        )
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras ?: return

        // EXTRA_BIG_TEXT has the full SMS body when Android expands the notification.
        // EXTRA_TEXT is the collapsed summary — may be truncated on some devices.
        // We prefer bigText; fall back to text if bigText is blank.
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty()
        val text    = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val title   = extras.getString(Notification.EXTRA_TITLE).orEmpty()

        val body = bigText.ifBlank { text }.trim()
        if (body.isBlank()) return

        // Two detection strategies — either the notification title says "MPESA"
        // (how Google Messages labels the sender ID), or the body starts with
        // the 10-char confirmation code pattern.
        val isMpesa = title.equals("MPESA", ignoreCase = true) ||
                      title.equals("M-PESA", ignoreCase = true) ||
                      MPESA_CONFIRM.containsMatchIn(body)

        if (!isMpesa) return

        Log.i(TAG, "M-Pesa notification captured — ${body.take(50)}…")
        postWebhook(body)
    }

    private fun postWebhook(smsBody: String) {
        val prefs = Webhook.prefs(this)

        if (Webhook.endpoint(prefs) == null) {
            Log.w(TAG, "Webhook URL or API key not configured — notification discarded")
            return
        }

        Thread {
            try {
                val code = Webhook.post(prefs, smsBody)
                Log.i(TAG, "Webhook delivered — HTTP $code")
            } catch (e: Exception) {
                Log.e(TAG, "Webhook failed: ${e.message}")
                // No retry here — the deferred STK check in the POS app
                // handles reconciliation when it comes back online.
            }
        }.start()
    }
}
