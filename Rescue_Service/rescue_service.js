require("dotenv").config();
const mqtt = require("mqtt");
const { createClient } = require("redis");

// Connect to the MQTT broker configured for this environment
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
    rejectUnauthorized: false
});

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379"
});

// A separate Redis connection is used when waiting for an available rescue team
const teamClient = redisClient.duplicate();

mqttClient.on("error", (error) => {
    console.error("MQTT connection error:", error.message);
});

mqttClient.on("offline", () => {
    console.error("MQTT client offline");
});

mqttClient.on("reconnect", () => {
    console.log("MQTT reconnecting...");
});

const teamTypes = [
    "CHILD_TRAPPED",
    "MEDICAL_EMERGENCY",
    "ELDERLY_NEEDS_HELP",
    "HOUSE_FLOODED",
    "FOOD_WATER_REQUEST"
];

const teamPrefixes = {
    CHILD_TRAPPED: "RESCUE",
    MEDICAL_EMERGENCY: "MEDICAL",
    ELDERLY_NEEDS_HELP: "ASSIST",
    HOUSE_FLOODED: "FLOOD",
    FOOD_WATER_REQUEST: "RELIEF"
};

redisClient.on("error", (error) => {
    console.error("Redis error:", error.message);
});

teamClient.on("error", (error) => {
    console.error("Redis team connection error:", error.message);
});

// Create the 50 rescue teams once in the shared Redis store
async function initialiseRescueTeams() {
    const created = await redisClient.set(
        "rescue:teams:initialized",
        "true",
        { NX: true }
    );

    if (created) {
        for (const type of teamTypes) {
            const teams = [];

            for (let i = 1; i <= 10; i++) {
                teams.push(`${teamPrefixes[type]}-${i}`);
            }

            await redisClient.rPush(`rescue:teams:${type}`, teams);
        }

        console.log("50 shared specialised rescue teams created");
    } else {
        console.log("Using existing 50 shared rescue teams");
    }
}

// Store flood event information once so every Rescue worker can access it
async function initialiseFloodEvent(request) {
    const eventKey = `flood:event:${request.eventId}`;

    await redisClient.hSetNX(
        eventKey,
        "eventStartTime",
        String(request.eventStartTime)
    );

    await redisClient.hSetNX(
        eventKey,
        "totalEventRequests",
        String(request.totalEventRequests)
    );

    await redisClient.hSetNX(eventKey, "zoneA", String(request.zoneA));
    await redisClient.hSetNX(eventKey, "zoneB", String(request.zoneB));
    await redisClient.hSetNX(eventKey, "zoneC", String(request.zoneC));
    await redisClient.hSetNX(eventKey, "completed", "0");

    return eventKey;
}

// Get one team from the shared pool
async function getAvailableTeam(emergencyType) {
    const result = await teamClient.blPop(
        `rescue:teams:${emergencyType}`,
        0
    );

    return result.element;
}

// Return the team to the same shared pool after completing the request
async function releaseTeam(emergencyType, teamId) {
    await redisClient.rPush(
        `rescue:teams:${emergencyType}`,
        teamId
    );
}

// Display the final result only once across all Rescue workers
async function checkEventComplete(eventKey, eventId, completed) {
    const event = await redisClient.hGetAll(eventKey);
    const totalRequests = Number(event.totalEventRequests);

    if (completed !== totalRequests) {
        return;
    }

    const resultLock = await redisClient.set(
        `flood:result:${eventId}`,
        "printed",
        { NX: true }
    );

    if (!resultLock) {
        return;
    }

    const eventEndTime = Date.now();
    const executionTime =
        (eventEndTime - Number(event.eventStartTime)) / 1000;

    console.log("\n========== FLOOD EVENT RESULT ==========");
    console.log("Zone A Water Level:", event.zoneA);
    console.log("Zone B Water Level:", event.zoneB);
    console.log("Zone C Water Level:", event.zoneC);
    console.log("Simulated Requests:", totalRequests);
    console.log("Requests Completed:", completed);
    console.log(
        "Execution Time:",
        executionTime.toFixed(3),
        "seconds"
    );
    console.log("========================================\n");
}

// Process one request using one of the same 50 shared rescue teams
async function processRequest(request) {
    const eventKey = await initialiseFloodEvent(request);

    const teamId = await getAvailableTeam(
        request.emergencyType
    );

    try {
        const completed = await redisClient.hIncrBy(
            eventKey,
            "completed",
            1
        );

        await checkEventComplete(
            eventKey,
            request.eventId,
            completed
        );
    } finally {
        await releaseTeam(
            request.emergencyType,
            teamId
        );
    }
}

async function startService() {
    await redisClient.connect();
    await teamClient.connect();

    console.log("Rescue Service connected to Redis");

    await initialiseRescueTeams();

    mqttClient.on("connect", () => {
        console.log("Rescue Service connected to MQTT");
        console.log("50 shared specialised rescue teams ready");
        console.log("Waiting for prioritized emergency requests...");

        // Shared subscription distributes requests between Rescue workers
        mqttClient.subscribe(
            "$share/rescue-workers/disaster/emergency/prioritized"
        );
    });

    mqttClient.on("message", async (topic, message) => {
        try {
            const request = JSON.parse(message.toString());
            await processRequest(request);
        } catch (error) {
            console.error(
                "Error processing rescue request:",
                error.message
            );
        }
    });
}

startService().catch((error) => {
    console.error("Failed to start Rescue Service:", error);
    process.exit(1);
});