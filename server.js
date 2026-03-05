const express = require("express")
const axios = require("axios")

const app = express()
app.use(express.json())

const TOKEN = "EAANeV5tPgr0BQZB7fVcJ2xNuMtBBsWkYyjXDswtEXFVpB2NvM8U2jHde3y64sZCvTahIH3n8OXJzSlSysmzj5CBX5jhfw6ISp6GOcH5AtMXwBA1TFC1USLfEiY7r91PhUZBDEOZCwnXa5ehZCZBfpfXnZAeYnXOevTZBrHoiXxVYWlrhRvdDEhyQ294sE1wsl6LezZAiKKAscQw9d5hDWGfnDbHFE9EkI3qUmZBYQTbuRwIeCKJvttMRFJixdID1eMJZBZCX1wG7gpj6tyT2llZC1fDV4z4yT4DxejyZCtzT7I0QZDZD"
const PHONE_ID = "937736869432295"

app.post("/webhook-c807", async (req, res) => {

    console.log("Webhook recibido:", req.body)

    if (!req.body || !req.body.guia) {
        console.log("Webhook vacío o inválido")
        return res.sendStatus(200)
    }

    try {

        const telefono = "50379191790"

        const mensaje = `📦 Actualización de envío
Guía: ${req.body.guia}
Estado: ${req.body.estatus}`

        const response = await axios.post(
            `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`,
            {
                messaging_product: "whatsapp",
                to: telefono,
                type: "text",
                text: { body: mensaje }
            },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    "Content-Type": "application/json"
                }
            }
        )

        console.log("Mensaje enviado a WhatsApp:", response.data)

    } catch (error) {
        console.log("ERROR WHATSAPP:")
        console.log(error.response?.data || error)
    }

    res.send("ok")
})

app.listen(3000, () => {
    console.log("Servidor escuchando en puerto 3000")
})