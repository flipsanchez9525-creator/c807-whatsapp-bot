const express = require("express")
const axios = require("axios")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const PHONE_ID = "937736869432295"
const TOKEN = process.env.WHATSAPP_TOKEN
// base de datos simple de guías
const guias = {}

async function enviarWhatsApp(telefono, mensaje) {

  try {

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: telefono,
        type: "text",
        text: {
          body: mensaje
        }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("Mensaje enviado a WhatsApp")

  } catch (error) {

    console.log("Error enviando WhatsApp:", error.response?.data || error.message)

  }

}
app.post("/registrar-guia", (req, res) => {

  const { guia, telefono, cliente } = req.body

  guias[guia] = {
    telefono,
    cliente
  }

  console.log("Guía registrada:", guia, telefono)

  res.json({ status: "ok" })

})
app.post('/webhook-c807', async (req, res) => {

  try {

    console.log("Webhook completo:", req.body)

    let raw = Object.keys(req.body)[0]

    if (!raw) {
      console.log("Webhook vacío")
      return res.sendStatus(200)
    }

    let data

try {
  data = JSON.parse(raw)
} catch (e) {
  console.log("JSON complejo recibido, intentando extraer datos")

  const guia = raw.match(/"guia":"([^"]+)"/)?.[1]
  const estatus = raw.match(/"estatus":"([^"]+)"/)?.[1]

  data = { guia, estatus }
}

    const guia = data?.guia
const estatus = data?.estatus || ""

if (!guia) {
  console.log("Webhook sin guía")
  return res.sendStatus(200)
}

console.log("Guia:", guia)
console.log("Estatus:", estatus)

    console.log("Guia:", guia)
    console.log("Estatus:", estatus)

    const cliente = guias[guia]

    if (!cliente) {
      console.log("Guía no registrada:", guia)
      return res.sendStatus(200)
    }

    const telefono = cliente.telefono

// MENSAJE CUANDO SE CREA LA GUÍA
if (estatus === "Creado en sistema") {

  let mensajeCreado = `📦 C807 Express - Cocinas de Empotrar SV

Hola ${cliente.cliente}

Tu pedido ha sido registrado en nuestro sistema.

Guía: ${guia}

Pronto será recolectado por el servicio de paqueteria 🚚

Puedes seguir el estado aquí:
https://c807xpress.com/tracking/?guia=${guia}`

  await enviarWhatsApp(telefono, mensajeCreado)

}

    // MENSAJE CUANDO SALE A RUTA
    if (estatus?.toLowerCase().includes("ruta")) {

      let mensajeRuta = `🚚 C807 Express - Cocinas de Empotrar SV

Hola ${cliente.cliente}

📦 Tu pedido ya va en camino.

Guía: ${guia}

Puedes seguirlo aquí:
https://c807xpress.com/tracking/?guia=${guia}`

      await enviarWhatsApp(telefono, mensajeRuta)

    }

    // MENSAJE FINAL
    if (estatus?.toLowerCase().includes("destino")) {

      let mensajeEntrega = `✅ C807 Express - Cocinas de Empotrar SV

Hola ${cliente.cliente}

Tu pedido fue entregado exitosamente.

📦 Guía: ${guia}

Puedes revisar el historial aquí:
https://c807xpress.com/tracking/?guia=${guia}

Gracias por confiar en nosotros 🙌`

      await enviarWhatsApp(telefono, mensajeEntrega)

    }

  } catch (err) {

    console.log("Error parseando webhook", err)

  }

  res.sendStatus(200)

})

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})