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
        to: "50379191790",,
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

    let data = JSON.parse(raw)

    const guia = data.guia
    const estatus = data.estatus

    console.log("Guia:", guia)
    console.log("Estatus:", estatus)

    const cliente = guias[guia]

    if (!cliente) {
      console.log("Guía no registrada:", guia)
      return res.sendStatus(200)
    }

    const telefono = cliente.telefono

    // MENSAJE CUANDO SALE A RUTA
    if (estatus === "En ruta") {

      let mensajeRuta = `🚚 C807 Express - Cocinas de Empotrar SV

Hola ${cliente.cliente}

📦 Tu pedido ya va en camino.

Guía: ${guia}

Puedes seguirlo aquí:
https://c807xpress.com/tracking/?guia=${guia}`

      await enviarWhatsApp(telefono, mensajeRuta)

    }

    // MENSAJE FINAL
    if (estatus === "Llegó a su destino") {

      let mensajeEntrega = `✅ C807 Express - Cocinas de Empotrar SV

Hola ${cliente.cliente}

Tu pedido fue entregado exitosamente.

Guía: ${guia}

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