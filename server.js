const express = require("express")
const axios = require("axios")

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const PHONE_ID = "937736869432295"
const TOKEN = process.env.WHATSAPP_TOKEN

async function enviarWhatsApp(mensaje) {

  try {

    await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: "50379191790",
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

app.post("/webhook-c807", async (req, res) => {

  console.log("Webhook completo:", req.body)

  let data

  try {

    const key = Object.keys(req.body)[0]
    data = JSON.parse(key)

  } catch (error) {

    console.log("Error parseando webhook")
    return res.sendStatus(200)

  }

  const guia = data.guia
  const estatus = data.estatus

  console.log("Guia:", guia)
  console.log("Estatus:", estatus)

  const mensaje = `📦 Actualización de envío

Guía: ${guia}
Estado: ${estatus}`

  await enviarWhatsApp(mensaje)

  res.sendStatus(200)

})

app.listen(3000, () => {
  console.log("Servidor escuchando en puerto 3000")
})