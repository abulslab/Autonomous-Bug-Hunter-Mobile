package com.bughunter.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import fi.iki.elonen.NanoHTTPD
import kotlinx.coroutines.launch
import org.json.JSONObject

data class VoiceVisit(val id: String, val doctor: String, val specialty: String, val date: String, val time: String, val status: String)

class VoiceEvaluateServer(
    private val backendUrl: String,
    portNumber: Int = 8080
) : NanoHTTPD("0.0.0.0", portNumber) {

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri.substringBefore('?').trim().trimEnd('/').ifEmpty { "/" }
        if (uri == "/health" && session.method == Method.GET) {
            return newFixedLengthResponse(Response.Status.OK, "application/json", JSONObject(mapOf("status" to "UP")).toString())
        }
        if (uri == "/ping" && session.method == Method.POST) {
            return newFixedLengthResponse(Response.Status.OK, "application/json", JSONObject(mapOf("status" to "OK")).toString())
        }
        if (uri == "/evaluate" && session.method == Method.POST) {
            val files = HashMap<String, String>()
            session.parseBody(files)
            val body = files["postData"].orEmpty()
            val req = try { JSONObject(body) } catch (_: Exception) { JSONObject() }
            val utterance = req.optString("utterance").trim()
            if (utterance.isEmpty()) {
                return newFixedLengthResponse(Response.Status.BAD_REQUEST, "application/json", JSONObject(mapOf("error" to "utterance is required")).toString())
            }
            val reply = JSONObject()
                .put("agentName", "VoiceAppointment")
                .put("backendUrl", backendUrl)
                .put("utterance", utterance)
                .put("response", "Scheduled appointment intent for: $utterance")
            return newFixedLengthResponse(Response.Status.OK, "application/json", reply.toString())
        }
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "application/json", JSONObject(mapOf("error" to "Not found")).toString())
    }
}

@Composable
fun VoiceAppointmentMobileApp(backendUrl: String) {
    val scope = rememberCoroutineScope()
    val client = remember(backendUrl) { MobileHttpClient(backendUrl) }

    var activeTab by remember { mutableStateOf("voice") }
    var listeningStatus by remember { mutableStateOf("Ready") }
    var recognizedSpeech by remember { mutableStateOf("Tap a voice prompt or the microphone button to schedule.") }
    var assistantResponse by remember { mutableStateOf("Hello! I am your Appointment Assistant. How can I help you today?") }
    var chatInput by remember { mutableStateOf("") }
    var chatMessages by remember {
        mutableStateOf(
            listOf(
                "Assistant" to "Welcome to Voice Appointment Mobile. Ask to schedule, reschedule, or cancel a visit."
            )
        )
    }
    var visits by remember {
        mutableStateOf(
            listOf(
                VoiceVisit("APT-101", "Dr. Sarah Smith, MD", "Cardiology", "2026-12-10", "02:00 PM", "Confirmed"),
                VoiceVisit("APT-102", "Dr. James Wilson, DDS", "Dentistry", "2026-12-12", "10:30 AM", "Pending")
            )
        )
    }
    var endpointUrl by remember { mutableStateOf(backendUrl) }
    var selectedModel by remember { mutableStateOf("llama3") }

    fun processVoiceIntent(utterance: String) {
        recognizedSpeech = utterance
        listeningStatus = "Processing..."
        val lower = utterance.lowercase()
        when {
            lower.contains("dental") || lower.contains("dentist") -> {
                val id = "APT-${100 + visits.size + 1}"
                visits = listOf(VoiceVisit(id, "Dr. James Wilson, DDS", "Dentistry", "2026-12-14", "02:00 PM", "Confirmed")) + visits
                assistantResponse = "Scheduled dental checkup with Dr. James Wilson ($id) for 2026-12-14 at 02:00 PM."
            }
            lower.contains("cardio") -> {
                val id = "APT-${100 + visits.size + 1}"
                visits = listOf(VoiceVisit(id, "Dr. Sarah Smith, MD", "Cardiology", "2026-12-15", "10:00 AM", "Confirmed")) + visits
                assistantResponse = "Confirmed cardiology consultation with Dr. Sarah Smith ($id) for 2026-12-15 at 10:00 AM."
            }
            lower.contains("cancel") -> {
                visits = visits.mapIndexed { idx, v -> if (idx == 0) v.copy(status = "Cancelled") else v }
                assistantResponse = "Cancelled your most recent appointment."
            }
            else -> {
                assistantResponse = "Processed voice request: $utterance"
            }
        }
        listeningStatus = "Ready"
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(
                    "voice" to "Voice",
                    "chat" to "Chat",
                    "visits" to "Visits",
                    "settings" to "Settings"
                ).forEach { (key, label) ->
                    NavigationBarItem(
                        selected = activeTab == key,
                        onClick = { activeTab = key },
                        icon = { Text(label.take(2)) },
                        label = { Text(label) },
                        modifier = Modifier.testTag("tab-$key").semantics { contentDescription = label }
                    )
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Voice Appointment Mobile", style = MaterialTheme.typography.headlineSmall)

            when (activeTab) {
                "voice" -> {
                    Text("Status: $listeningStatus", modifier = Modifier.testTag("voice-status"))
                    Box(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Button(
                            onClick = { processVoiceIntent("Schedule a dental checkup for Friday at 2 PM") },
                            shape = CircleShape,
                            modifier = Modifier.size(120.dp).testTag("mic-button")
                        ) { Text("Mic") }
                    }
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Recognized Speech", style = MaterialTheme.typography.titleSmall)
                            Text(recognizedSpeech, modifier = Modifier.testTag("recognized-speech"))
                        }
                    }
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Assistant Response", style = MaterialTheme.typography.titleSmall)
                            Text(assistantResponse, modifier = Modifier.testTag("assistant-response"))
                        }
                    }
                    listOf(
                        "Book a dental appointment for Friday at 2 PM",
                        "Schedule cardiology consultation for Monday at 10 AM",
                        "Cancel my most recent appointment"
                    ).forEachIndexed { idx, prompt ->
                        OutlinedButton(
                            onClick = { processVoiceIntent(prompt) },
                            modifier = Modifier.fillMaxWidth().testTag("voice-prompt-$idx")
                        ) { Text(prompt) }
                    }
                }

                "chat" -> {
                    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(chatMessages) { (author, msg) ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(10.dp)) {
                                    Text(author, style = MaterialTheme.typography.labelSmall)
                                    Text(msg)
                                }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = chatInput,
                            onValueChange = { chatInput = it },
                            placeholder = { Text("Type a message") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("chat-input")
                        )
                        Button(
                            onClick = {
                                val msg = chatInput.trim()
                                if (msg.isNotEmpty()) {
                                    chatMessages = chatMessages + ("User" to msg)
                                    chatInput = ""
                                    processVoiceIntent(msg)
                                    chatMessages = chatMessages + ("Assistant" to assistantResponse)
                                }
                            },
                            modifier = Modifier.testTag("chat-send-btn")
                        ) { Text("Send") }
                    }
                }

                "visits" -> {
                    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(visits, key = { it.id }) { v ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text("${v.id} · ${v.doctor} (${v.specialty})", style = MaterialTheme.typography.titleSmall)
                                    Text("${v.date} at ${v.time} · Status: ${v.status}")
                                }
                            }
                        }
                    }
                }

                "settings" -> {
                    OutlinedTextField(
                        value = endpointUrl,
                        onValueChange = { endpointUrl = it; client.baseUrl = it },
                        label = { Text("Backend / Ollama URL") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("settings-url-input")
                    )
                    OutlinedTextField(
                        value = selectedModel,
                        onValueChange = { selectedModel = it },
                        label = { Text("Model") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("settings-model-input")
                    )
                    Button(
                        onClick = {
                            scope.launch {
                                val res = client.request("GET", "/api/tags")
                                assistantResponse = if (res.ok) "Endpoint Reachable" else "Status: ${res.status}"
                            }
                        },
                        modifier = Modifier.fillMaxWidth().testTag("test-connectivity-btn")
                    ) { Text("Test Connectivity") }
                }
            }
        }
    }
}
