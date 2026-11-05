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

data class ProductItem(val id: String, val name: String, val price: Double, val category: String, val stock: Int)
data class OrderItem(val id: String, val status: String, val total: Double, val email: String)

@Composable
fun DemoShopMobileApp(backendUrl: String) {
    val scope = rememberCoroutineScope()
    val client = remember(backendUrl) { MobileHttpClient(backendUrl) }

    var activeTab by remember { mutableStateOf("catalog") }
    var searchQuery by remember { mutableStateOf("") }
    var products by remember { mutableStateOf(listOf<ProductItem>()) }
    var cartTotal by remember { mutableStateOf(0.0) }
    var cartCount by remember { mutableStateOf(0) }
    var couponCode by remember { mutableStateOf("") }
    var qtyInput by remember { mutableStateOf("1") }
    var giftWrap by remember { mutableStateOf(false) }
    var cardNumber by remember { mutableStateOf("4111111111111111") }
    var cardExpiry by remember { mutableStateOf("12/28") }
    var shippingAddress by remember { mutableStateOf("100 Market St, San Francisco, CA") }
    var loginEmail by remember { mutableStateOf("shopper01@shop.demo") }
    var loginPassword by remember { mutableStateOf("Shop123!") }
    var signedInUser by remember { mutableStateOf<String?>(null) }
    var orders by remember { mutableStateOf(listOf<OrderItem>()) }
    var statusMessage by remember { mutableStateOf("Demo Supply Co. Mobile App Ready") }

    fun parseProducts(res: ApiResponse): List<ProductItem> {
        val arr = res.jsonObj()?.optJSONArray("items") ?: res.jsonArr() ?: return emptyList()
        val list = mutableListOf<ProductItem>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                ProductItem(
                    id = o.optString("id"),
                    name = o.optString("name"),
                    price = o.optDouble("price", 0.0),
                    category = o.optString("category"),
                    stock = o.optInt("stock", 0)
                )
            )
        }
        return list
    }

    fun parseOrders(res: ApiResponse): List<OrderItem> {
        val arr = res.jsonObj()?.optJSONArray("items") ?: res.jsonArr() ?: return emptyList()
        val list = mutableListOf<OrderItem>()
        for (i in 0 until arr.length()) {
            val o = arr.getJSONObject(i)
            list.add(
                OrderItem(
                    id = o.optString("id"),
                    status = o.optString("status"),
                    total = o.optDouble("total", 0.0),
                    email = o.optString("email", "")
                )
            )
        }
        return list
    }

    suspend fun refreshCatalog(q: String = "") {
        val path = if (q.isBlank()) "/api/products" else "/api/products?q=$q"
        val res = client.request("GET", path)
        if (res.ok) products = parseProducts(res)
    }

    suspend fun refreshCart() {
        val res = client.request("GET", "/api/cart")
        res.jsonObj()?.let { obj ->
            cartTotal = obj.optDouble("total", 0.0)
            cartCount = obj.optJSONArray("items")?.length() ?: 0
        }
    }

    LaunchedEffect(Unit) {
        refreshCatalog()
        refreshCart()
    }

    Scaffold(
        bottomBar = {
            NavigationBar {
                listOf(
                    "catalog" to "Catalog",
                    "cart" to "Cart ($cartCount)",
                    "orders" to "Orders",
                    "desk" to "Order Desk",
                    "account" to "Sign In"
                ).forEach { (key, label) ->
                    NavigationBarItem(
                        selected = activeTab == key,
                        onClick = {
                            activeTab = key
                            scope.launch {
                                if (key == "catalog") refreshCatalog(searchQuery)
                                if (key == "cart") refreshCart()
                                if (key == "orders") orders = parseOrders(client.request("GET", "/api/orders"))
                                if (key == "desk") orders = parseOrders(client.request("GET", "/api/staff/orders"))
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
                text = "Demo Shop Mobile · ${signedInUser ?: "Guest"}",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = statusMessage,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.testTag("status-banner")
            )

            when (activeTab) {
                "catalog" -> {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            label = { Text("Search products") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("search-input")
                        )
                        Button(
                            onClick = { scope.launch { refreshCatalog(searchQuery) } },
                            modifier = Modifier.testTag("search-button")
                        ) { Text("Search") }
                    }
                    OutlinedTextField(
                        value = qtyInput,
                        onValueChange = { qtyInput = it },
                        label = { Text("Quantity") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("quantity-input")
                    )
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(products, key = { it.id }) { p ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    modifier = Modifier.fillMaxWidth().padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("${p.name} ($${p.price})", style = MaterialTheme.typography.titleSmall)
                                        Text("${p.category} · Stock: ${p.stock}", style = MaterialTheme.typography.bodySmall)
                                    }
                                    Button(
                                        onClick = {
                                            scope.launch {
                                                val qty = qtyInput.toIntOrNull() ?: 1
                                                val body = JSONObject().put("productId", p.id).put("qty", qty)
                                                val res = client.request("POST", "/api/cart/items", body)
                                                statusMessage = if (res.ok) "Added ${p.name} x$qty" else "Error ${res.status}: ${res.body}"
                                                refreshCart()
                                            }
                                        },
                                        modifier = Modifier.testTag("add-${p.id}")
                                    ) { Text("Add to Cart") }
                                }
                            }
                        }
                    }
                }

                "cart" -> {
                    Text("Cart Total: $${"%.2f".format(cartTotal)} ($cartCount items)", style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = couponCode,
                            onValueChange = { couponCode = it },
                            label = { Text("Coupon code") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("coupon-input")
                        )
                        Button(
                            onClick = {
                                scope.launch {
                                    val res = client.request("POST", "/api/cart/coupon", JSONObject().put("code", couponCode))
                                    statusMessage = if (res.ok) "Applied coupon $couponCode" else "Coupon rejected: ${res.status}"
                                    refreshCart()
                                }
                            },
                            modifier = Modifier.testTag("apply-coupon-btn")
                        ) { Text("Apply Coupon") }
                    }
                    OutlinedTextField(
                        value = shippingAddress,
                        onValueChange = { shippingAddress = it },
                        label = { Text("Shipping Address") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("address-input")
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedTextField(
                            value = cardNumber,
                            onValueChange = { cardNumber = it },
                            label = { Text("Card Number") },
                            singleLine = true,
                            modifier = Modifier.weight(1f).testTag("card-input")
                        )
                        OutlinedTextField(
                            value = cardExpiry,
                            onValueChange = { cardExpiry = it },
                            label = { Text("Expiry (MM/YY)") },
                            singleLine = true,
                            modifier = Modifier.width(130.dp).testTag("expiry-input")
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = giftWrap,
                            onCheckedChange = { giftWrap = it },
                            modifier = Modifier.testTag("gift-wrap-checkbox")
                        )
                        Text("Add Gift Wrap ($4.99)")
                    }
                    Button(
                        onClick = {
                            scope.launch {
                                val body = JSONObject()
                                    .put("address", shippingAddress)
                                    .put("card", cardNumber)
                                    .put("expiry", cardExpiry)
                                    .put("giftWrap", giftWrap)
                                val res = client.request("POST", "/api/orders", body)
                                statusMessage = if (res.ok) "Order placed!" else "Checkout failed (${res.status}): ${res.body}"
                                refreshCart()
                            }
                        },
                        modifier = Modifier.fillMaxWidth().testTag("place-order-btn")
                    ) { Text("Place Order") }
                }

                "orders", "desk" -> {
                    val isStaff = activeTab == "desk"
                    Text(if (isStaff) "Staff Order Desk" else "My Orders", style = MaterialTheme.typography.titleMedium)
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                        items(orders, key = { it.id }) { o ->
                            Card(modifier = Modifier.fillMaxWidth()) {
                                Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("Order ${o.id} · ${o.status} · $${"%.2f".format(o.total)}")
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (isStaff) {
                                            Button(
                                                onClick = {
                                                    scope.launch {
                                                        val res = client.request("POST", "/api/staff/orders/${o.id}/ship")
                                                        statusMessage = "Ship ${o.id}: ${res.status}"
                                                        orders = parseOrders(client.request("GET", "/api/staff/orders"))
                                                    }
                                                },
                                                modifier = Modifier.testTag("ship-${o.id}")
                                            ) { Text("Ship") }
                                            Button(
                                                onClick = {
                                                    scope.launch {
                                                        val res = client.request("POST", "/api/staff/orders/${o.id}/deliver")
                                                        statusMessage = "Deliver ${o.id}: ${res.status}"
                                                        orders = parseOrders(client.request("GET", "/api/staff/orders"))
                                                    }
                                                },
                                                modifier = Modifier.testTag("deliver-${o.id}")
                                            ) { Text("Deliver") }
                                        } else {
                                            Button(
                                                onClick = {
                                                    scope.launch {
                                                        val res = client.request("POST", "/api/orders/${o.id}/cancel")
                                                        statusMessage = "Cancel ${o.id}: ${res.status}"
                                                        orders = parseOrders(client.request("GET", "/api/orders"))
                                                    }
                                                },
                                                modifier = Modifier.testTag("cancel-${o.id}")
                                            ) { Text("Cancel Order") }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                "account" -> {
                    OutlinedTextField(
                        value = loginEmail,
                        onValueChange = { loginEmail = it },
                        label = { Text("Email") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("login-email")
                    )
                    OutlinedTextField(
                        value = loginPassword,
                        onValueChange = { loginPassword = it },
                        label = { Text("Password") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("login-password")
                    )
                    Button(
                        onClick = {
                            scope.launch {
                                val res = client.request(
                                    "POST",
                                    "/api/auth/login",
                                    JSONObject().put("email", loginEmail).put("password", loginPassword)
                                )
                                val obj = res.jsonObj()
                                val token = obj?.optString("token")
                                if (res.ok && !token.isNullOrEmpty()) {
                                    client.setHeader("X-Sim-Session", token)
                                    signedInUser = loginEmail
                                    statusMessage = "Signed in as $loginEmail"
                                } else {
                                    statusMessage = "Sign-in failed (${res.status})"
                                }
                            }
                        },
                        modifier = Modifier.fillMaxWidth().testTag("sign-in-btn")
                    ) { Text("Sign In") }
                }
            }
        }
    }
}
