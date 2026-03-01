const axios = require("axios");

exports.handler = async (event) => {
    // শুধুমাত্র POST রিকোয়েস্ট এলাউ করা
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { userId } = JSON.parse(event.body);
        const BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"; // আপনার বট টোকেন দিন
        const CHANNEL_ID = "@PPCoinChannel";

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${CHANNEL_ID}&user_id=${userId}`;
        const response = await axios.get(url);
        
        const status = response.data.result.status;
        const isJoined = ["member", "administrator", "creator"].includes(status);

        return {
            statusCode: 200,
            headers: { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" 
            },
            body: JSON.stringify({ joined: isJoined })
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ joined: false, error: "Internal Server Error" })
        };
    }
};
