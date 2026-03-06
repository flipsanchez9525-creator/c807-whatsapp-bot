const express = require("express")
const axios = require("axios")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ============================
// CONFIG
// ============================

const PHONE_ID = "937736869432295"
const TOKEN = process.env.WHATSAPP_TOKEN

// número del administrador
const ADMIN_PHONE = "50379191790"

// base de datos simple (memoria)
const guias = {}
const mensajesEnviados = {}

// ============================
// UTILIDADES
// ============================

function normalizarTelefono(numero) {
  if (!numero) return null

  let limpio = String(numero).replace(/\D/g, "")

  if (!limpio.startsWith("503")) {
    limpio = "503" + limpio
  }

  return limpio
}

// ============================
// CONSULTAR TELEFONO EN C807
// ============================

async function obtenerTelefonoDesdeC807(guia) {
  try {
    const url = `https://app.c807.com/guia.php/madre/ver?guia=${guia}`

    console.log("Consultando C807:", url)

    const response = await axios.get(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 15000
    })

    const data = response.data

    const telefono = data?.datos?.destinatario?.telefono
    const codigo = data?.datos?.destinatario?.codigo_area || "503"

    if (!telefono) {
      console.log("No se encontró teléfono en C807")
      return null
    }

    const telefonoCompleto = normalizarTelefono(`${codigo}${telefono}`)

    console.log("Telefono encontrado en C807:", telefonoCompleto)

    return telefonoCompleto
  } catch (err) {
    console.log("Error consultando C807:", err.response?.data || err.message)
    return null
  }
}

// ============================
// ENVIAR WHATSAPP
// ============================

async function enviarWhatsApp(telefono, mensaje, guia = "", estatus = "") {
  const telefonoCliente = normalizarTelefono(telefono)
  const telefonoAdmin = normalizarTelefono(ADMIN_PHONE)

  if (!telefonoCliente) {
    console.log("No hay teléfono válido para enviar WhatsApp")
    return {
      enviadoCliente: false,
      enviadoAdmin: false,
      errorCliente: "Telefono inválido"
    }
  }

  if (!telefonoAdmin) {
    console.log("No hay teléfono válido del administrador")
    return {
      enviadoCliente: false,
      enviadoAdmin: false,
      errorCliente: "Telefono admin inválido"
    }
  }

  if (!mensaje) {
    console.log("No hay mensaje para enviar")
    return {
      enviadoCliente: false,
      enviadoAdmin: false,
      errorCliente: "Mensaje vacío"
    }
  }

  let enviadoCliente = false
  let enviadoAdmin = false
  let errorCliente = null

  try {
    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefonoCliente,
        type: "text",
        text: { body: mensaje }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    )

    enviadoCliente = true
    console.log("Mensaje enviado a cliente:", telefonoCliente)
  } catch (error) {
    errorCliente = error.response?.data || error.message
    console.log("Error enviando al cliente:", errorCliente)
  }

  try {
    const copiaAdmin = `📢 REPORTE DE ENVÍO

Guía: ${guia}
Estatus: ${estatus}
Cliente: ${telefonoCliente}
Resultado cliente: ${enviadoCliente ? "ENVIADO" : "FALLÓ"}

${!enviadoCliente ? `Error: ${JSON.stringify(errorCliente)}\n` : ""}Mensaje enviado:
${mensaje}`

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefonoAdmin,
        type: "text",
        text: { body: copiaAdmin }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        },
        timeout: 15000
      }
    )

    enviadoAdmin = true
    console.log("Copia enviada al admin")
  } catch (error) {
    console.log("Error enviando copia:", error.response?.data || error.message)
  }

  return {
    enviadoCliente,
    enviadoAdmin,
    errorCliente
  }
}

// ============================
// REGISTRAR GUIA MANUAL
// ============================

app.post("/registrar-guia", (req, res) => {
  const { guia, telefono, cliente } = req.body

  if (!guia) {
    return res.status(400).json({ error: "La guía es obligatoria" })
  }

  guias[guia] = {
    telefono: normalizarTelefono(telefono),
    cliente: cliente || ""
  }

  console.log("Guía registrada manualmente:", guia, guias[guia])

  res.json({ status: "ok", guia })
})

// ============================
// WEBHOOK C807
// ============================

app.post("/webhook-c807", async (req, res) => {
  try {
    console.log("Webhook recibido:", req.body)

    let raw = Object.keys(req.body)[0]
    let data

    // si C807 envía JSON normal
    if (req.body.guia) {
      data = req.body
    } else if (raw) {
      try {
        data = JSON.parse(raw)
      } catch (e) {
        console.log("JSON complejo recibido")

        const guia = raw.match(/"guia":"([^"]+)"/)?.[1]
        const estatus = raw.match(/"estatus":"([^"]+)"/)?.[1]

        data = { guia, estatus }
      }
    } else {
      console.log("Webhook vacío")
      return res.sendStatus(200)
    }

    const guia = data?.guia
    const estatus = data?.estatus || ""

    if (!guia) {
      console.log("Webhook sin guía")
      return res.sendStatus(200)
    }

    console.log("Guia:", guia)
    console.log("Estatus:", estatus)

    // evitar duplicados
    const clave = `${guia}|${estatus}`

    if (mensajesEnviados[clave]) {
      console.log("Mensaje ya enviado")
      return res.sendStatus(200)
    }

    let cliente = guias[guia]
    let telefono = normalizarTelefono(cliente?.telefono)

    // si no está registrado, consultar C807
    if (!telefono) {
      telefono = await obtenerTelefonoDesdeC807(guia)

      if (!telefono) {
        console.log("No se pudo obtener teléfono")
        return res.sendStatus(200)
      }
    }

    let mensaje = null
    const estatusLower = estatus.toLowerCase()

    // ============================
    // MENSAJE CUANDO SE CREA
    // ============================
    if (estatus === "Creado en sistema") {
      mensaje = `📦 C807 Express - Cocinas de Empotrar SV

Tu pedido ha sido registrado en nuestro sistema.

Guía: ${guia}

Pronto será recolectado por el servicio de paquetería 🚚

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`
    }

    // ============================
    // CUANDO VA EN RUTA
    // ============================
    else if (estatusLower.includes("ruta")) {
      mensaje = `🚚 C807 Express - Cocinas de Empotrar SV

Tu pedido ya va en camino.

Guía: ${guia}

Seguimiento:
https://c807xpress.com/tracking/?guia=${guia}`
    }

    // ============================
    // CUANDO SE ENTREGA
    // ============================
    else if (
      estatusLower.includes("destino") ||
      estatusLower.includes("entregado")
    ) {
      mensaje = `✅ C807 Express - Cocinas de Empotrar SV

Tu pedido fue entregado exitosamente.

Guía: ${guia}

Historial:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en nosotros 🙌`
    }

    if (!mensaje) {
      console.log("Estatus sin mensaje configurado:", estatus)
      return res.sendStatus(200)
    }

    const resultado = await enviarWhatsApp(telefono, mensaje, guia, estatus)

    if (resultado?.enviadoCliente || resultado?.enviadoAdmin) {
      mensajesEnviados[clave] = true
    }

    console.log("Resultado envío:", resultado)
  } catch (err) {
    console.log("Error procesando webhook:", err.response?.data || err.message || err)
  }

  res.sendStatus(200)
})

// ============================
// HEALTHCHECK
// ============================

app.get("/", (req, res) => {
  res.send("Bot C807 activo")
})

// ============================

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})