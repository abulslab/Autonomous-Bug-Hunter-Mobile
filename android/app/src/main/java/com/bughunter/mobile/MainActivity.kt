package com.bughunter.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

class MainActivity : ComponentActivity() {
    private var evaluateServer: VoiceEvaluateServer? = null

    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val flavor = intent?.getStringExtra("flavor") ?: BuildConfig.APP_FLAVOR
        val backendUrl = intent?.getStringExtra("backendUrl") ?: BuildConfig.DEFAULT_BACKEND

        if (flavor == "voice") {
            try {
                evaluateServer = VoiceEvaluateServer(backendUrl, 8080).also { it.start(5000, false) }
            } catch (_: Exception) {
                // Ignore if already bound
            }
        }

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier
                        .fillMaxSize()
                        .semantics { testTagsAsResourceId = true }
                ) {
                    when (flavor) {
                        "shop" -> DemoShopMobileApp(backendUrl)
                        "hotel" -> DemoHotelMobileApp(backendUrl)
                        else -> VoiceAppointmentMobileApp(backendUrl)
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        evaluateServer?.stop()
        super.onDestroy()
    }
}
