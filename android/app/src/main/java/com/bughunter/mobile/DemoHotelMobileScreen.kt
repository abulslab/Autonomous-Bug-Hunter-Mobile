package com.bughunter.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

data class RoomItem(val id: String, val name: String, val rate: Double, val maxGuests: Int, val description: String)
data class BookingItem(val id: String, val roomName: String, val checkIn: String, val checkOut: String, val total: Double, val status: String)

@Composable
fun DemoHotelMobileApp(backendUrl: String) {
    val scope = rememberCoroutineScope()
    val client = remember(backendUrl) { MobileHttpClient(backendUrl) }

    var activeTab by remember { mutableStateOf("book") }
    var rooms by remember { mutableStateOf(listOf<RoomItem>()) }
    var selectedRoomId by remember { mutableStateOf("r-101") }
    var checkIn by remember { mutableStateOf("2026-12-10") }
    var checkOut by remember { mutableStateOf("2026-12-13") }
    var guests by remember { mutableStateOf("2") }
    var guestName by remember { mutableStateOf("Alex Rivera") }
    var guestEmail by remember { mutableStateOf("alex@example.test") }
    var includeBreakfast by remember { mutableStateOf(false) }
    var staffEmail by remember { mutableStateOf("desk@hotel.demo") }
    var staffPassword by remember { mutableStateOf("Desk123!") }
    var isStaffSignedIn by remember { mutableStateOf(false) }
    var bookings by remember { mutableStateOf(listOf<BookingItem>()) }
    var statusMessage by remember { mutableStateOf("Demo Hotel Mobile Ready") }

    fun parseRooms(res: ApiResponse): List<RoomItem> {
        val arr = res.jsonObj()?.optJSONArray("items") ?: return emptyList()
        val list = mutableListOf<RoomItem>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                RoomItem(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    rate = o.optDouble("rate", 0.0),
                    maxGuests = o.optInt("maxGuests", 1),
                    description = o.optString("description")
                )
            )
        }
        return list
    }

    fun parseBookings(res: ApiResponse): List<BookingItem> {
        val arr = res.jsonObj()?.optJSONArray("items") ?: return emptyList()
        val list = mutableListOf<BookingItem>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                BookingItem(
                    id = o.optString("id"),
                    roomName = o.optString("roomName"),
                    checkIn = o.optString("checkIn"),
                    checkOut = o.optString("checkOut"),
                    total = o.optDouble("total", 0.0),
                    status = o.optString("status")
                )
            )
        }
        return list
    }

    LaunchedEffect(Unit) {
        val res = client.request("GET", "/api/rooms")
        if (res.ok) rooms = parseRooms(res)
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(
                    "book" to "Rooms & Book",
                    "bookings" to "My Stays",
                    "desk" to "Front Desk"
                ).forEach { (key, label) ->
                    NavigationBarItem(
                        selected = activeTab == key,
                        onClick = {
                            activeTab = key
                            scope.launch {
                                if (key == "book") rooms = parseRooms(client.request("GET", "/api/rooms"))
                                if (key == "bookings") bookings = parseBookings(client.request("GET", "/api/bookings"))
                                if (key == "desk") bookings = parseBookings(client.request("GET", "/api/staff/bookings"))
                            }
                        },
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
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "Demo Hotel Mobile · ${if (isStaffSignedIn) "Front Desk" else "Guest"}",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = statusMessage,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("hotel-status-banner")
            )

            when (activeTab) {
                "book" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = checkIn,
                            onValueChange = { checkIn = it },
                            label = { Text("Check-in (YYYY-MM-DD)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("checkin-input")
                        )
                        OutlinedTextField(
                            value = checkOut,
                            onValueChange = { checkOut = it },
                            label = { Text("Check-out (YYYY-MM-DD)") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("checkout-input")
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = guests,
                            onValueChange = { guests = it },
                            label = { Text("Guests") },
                            singleLine = true,
                            modifier = Modifier.width(100.dp).testTag("guests-input")
                        )
                        OutlinedTextField(
                            value = guestName,
                            onValueChange = { guestName = it },
                            label = { Text("Guest Name") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("guest-name-input")
                        )
                    }
                    OutlinedTextField(
                        value = guestEmail,
                        onValueChange = { guestEmail = it },
                        label = { Text("Guest Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("guest-email-input")
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = includeBreakfast,
                            onCheckedChange = { includeBreakfast = it },
                            modifier = Modifier.testTag("breakfast-checkbox")
                        )
                        Text("Include Breakfast ($15 / night)")
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(rooms, key = { it.id }) { r ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("${r.name} ($${r.rate}/night)", style = MaterialTheme.typography.titleSmall)
                                        Text("Max ${r.maxGuests} guests · ${r.description}", style = MaterialTheme.typography.bodySmall)
                                    }
                                    Button(
                                        onClick = {
                                            selectedRoomId = r.id
                                            scope.launch {
                                                val body = JSONObject()
                                                    .put("roomId", r.id)
                                                    .put("checkIn", checkIn)
                                                    .put("checkOut", checkOut)
                                                    .put("guests", guests.toIntOrNull() ?: 1)
                                                    .put("name", guestName)
                                                    .put("email", guestEmail)
                                                    .put("breakfast", includeBreakfast)
                                                val res = client.request("POST", "/api/bookings", body)
                                                statusMessage = if (res.ok) "Booked ${r.name}!" else "Booking failed (${res.status}): ${res.body}"
                                            }
                                        },
                                        modifier = Modifier.testTag("book-${r.id}")
                                    ) { Text("Book Stay") }
                                }
                            }
                        }
                    }
                }

                "bookings" -> {
                    Text("My Bookings", style = MaterialTheme.typography.titleMedium)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(bookings, key = { it.id }) { b ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("${b.roomName} · ${b.status} · $${"%.2f".format(b.total)}")
                                        Text("${b.checkIn} to ${b.checkOut}", style = MaterialTheme.typography.bodySmall)
                                    }
                                    Button(
                                        onClick = {
                                            scope.launch {
                                                val res = client.request("POST", "/api/bookings/${b.id}/cancel")
                                                statusMessage = "Cancel ${b.id}: ${res.status}"
                                                bookings = parseBookings(client.request("GET", "/api/bookings"))
                                            }
                                        },
                                        modifier = Modifier.testTag("cancel-booking-${b.id}")
                                    ) { Text("Cancel") }
                                }
                            }
                        }
                    }
                }

                "desk" -> {
                    Text("Front Desk", style = MaterialTheme.typography.titleMedium)
                    if (!isStaffSignedIn) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(
                                value = staffEmail,
                                onValueChange = { staffEmail = it },
                                label = { Text("Staff Email") },
                                singleLine = true,
                                modifier = Modifier.weight(1f).testTag("staff-email-input")
                            )
                            OutlinedTextField(
                                value = staffPassword,
                                onValueChange = { staffPassword = it },
                                label = { Text("Password") },
                                singleLine = true,
                                modifier = Modifier.weight(1f).testTag("staff-password-input")
                            )
                        }
                        Button(
                            onClick = {
                                scope.launch {
                                    val res = client.request(
                                        "POST",
                                        "/api/staff/login",
                                        JSONObject().put("email", staffEmail).put("password", staffPassword)
                                    )
                                    val token = res.jsonObj()?.optString("token")
                                    if (res.ok && !token.isNullOrEmpty()) {
                                        client.setHeader("X-Staff-Session", token)
                                        isStaffSignedIn = true
                                        statusMessage = "Front desk signed in"
                                        bookings = parseBookings(client.request("GET", "/api/staff/bookings"))
                                    } else {
                                        statusMessage = "Front-desk sign-in failed (${res.status})"
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().testTag("staff-login-btn")
                        ) { Text("Front Desk Sign In") }
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(bookings, key = { it.id }) { b ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("${b.id} · ${b.roomName} · ${b.status} · $${"%.2f".format(b.total)}")
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    val res = client.request("POST", "/api/staff/bookings/${b.id}/checkin")
                                                    statusMessage = "Check-in ${b.id}: ${res.status}"
                                                    bookings = parseBookings(client.request("GET", "/api/staff/bookings"))
                                                }
                                            },
                                            modifier = Modifier.testTag("checkin-${b.id}")
                                        ) { Text("Check In") }
                                        Button(
                                            onClick = {
                                                scope.launch {
                                                    val res = client.request("POST", "/api/staff/bookings/${b.id}/checkout")
                                                    statusMessage = "Check-out ${b.id}: ${res.status}"
                                                    bookings = parseBookings(client.request("GET", "/api/staff/bookings"))
                                                }
                                            },
                                            modifier = Modifier.testTag("checkout-${b.id}")
                                        ) { Text("Check Out") }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
