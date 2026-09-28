require("dotenv").config();

const mqtt = require("mqtt");
const { createClient } = require("redis");

// ---------------- MQTT ----------------

const mqttClient = mqtt.connect(process.env.MQTT_URL, {
    rejectUnauthorized: false
});

// IMPORTANT: register MQTT listeners immediately
mqttClient.on("connect", () => {
    console.log("Rescue Service connected to MQTT");
    console.log("Waiting for prioritized emergency requests...");

    mqttClient.subscribe(
        "$share/rescue-workers/disaster/emergency/prioritized",
        (error) => {
            if (error) {
                console.error(
                    "MQTT subscription error:",
                    error.message
                );
            } else {
                console.log(
                    "Rescue Service subscribed to prioritized requests"
                );
            }
        }
    );
});

mqttClient.on("error", (error) => {
    console.error(
        "MQTT connection error:",
        error.message
    );
});

mqttClient.on("offline", () => {
    console.error("MQTT client offline");
});

mqttClient.on("reconnect", () => {
    console.log("MQTT reconnecting...");
});

// ---------------- REDIS ----------------

const redisClient = createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379"
});

// Separate Redis connection for blocking BLPOP
const teamClient = redisClient.duplicate();

redisClient.on("error", (error) => {
    console.error("Redis error:", error.message);
});

teamClient.on("error", (error) => {
    console.error(
        "Redis team connection error:",
        error.message
    );
});

// ---------------- RESCUE TEAMS ----------------

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

// Create the 50 teams only once in shared Redis
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
                teams.push(
                    `${teamPrefixes[type]}-${i}`
                );
            }

            await redisClient.rPush(
                `rescue:teams:${type}`,
                teams
            );
        }

        console.log(
            "50 shared specialised rescue teams created"
        );
    } else {
        console.log(
            "Using existing 50 shared rescue teams"
        );
    }
}

// ---------------- FLOOD EVENT ----------------

async function initialiseFloodEvent(request) {
    const eventKey =
        `flood:event:${request.eventId}`;

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

    await redisClient.hSetNX(
        eventKey,
        "zoneA",
        String(request.zoneA)
    );

    await redisClient.hSetNX(
        eventKey,
        "zoneB",
        String(request.zoneB)
    );

    await redisClient.hSetNX(
        eventKey,
        "zoneC",
        String(request.zoneC)
    );

    await redisClient.hSetNX(
        eventKey,
        "completed",
        "0"
    );

    return eventKey;
}

// ---------------- TEAM ALLOCATION ----------------

async function getAvailableTeam(emergencyType) {
    const result = await teamClient.blPop(
        `rescue:teams:${emergencyType}`,
        0
    );

    return result.element;
}

async function releaseTeam(
    emergencyType,
    teamId
) {
    await redisClient.rPush(
        `rescue:teams:${emergencyType}`,
        teamId
    );
}

// ---------------- EVENT COMPLETION ----------------

async function checkEventComplete(
    eventKey,
    eventId,
    completed
) {
    const event =
        await redisClient.hGetAll(eventKey);

    const totalRequests =
        Number(event.totalEventRequests);

    if (completed !== totalRequests) {
        return;
    }

    // Only one Rescue worker prints the result
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
        (
            eventEndTime -
            Number(event.eventStartTime)
        ) / 1000;

    console.log(
        "\n========== FLOOD EVENT RESULT =========="
    );

    console.log(
        "Zone A Water Level:",
        event.zoneA
    );

    console.log(
        "Zone B Water Level:",
        event.zoneB
    );

    console.log(
        "Zone C Water Level:",
        event.zoneC
    );

    console.log(
        "Simulated Requests:",
        totalRequests
    );

    console.log(
        "Requests Completed:",
        completed
    );

    console.log(
        "Execution Time:",
        executionTime.toFixed(3),
        "seconds"
    );

    console.log(
        "========================================\n"
    );
}

// ---------------- PROCESS REQUEST ----------------

async function processRequest(request) {
    const eventKey =
        await initialiseFloodEvent(request);

    const teamId =
        await getAvailableTeam(
            request.emergencyType
        );

    try {
        const completed =
            await redisClient.hIncrBy(
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

// Register message listener immediately too
mqttClient.on(
    "message",
    async (topic, message) => {
        try {
            const request =
                JSON.parse(message.toString());

            await processRequest(request);

        } catch (error) {
            console.error(
                "Error processing rescue request:",
                error.message
            );
        }
    }
);

// ---------------- START SERVICE ----------------

async function startService() {
    await redisClient.connect();
    await teamClient.connect();

    console.log(
        "Rescue Service connected to Redis"
    );

    await initialiseRescueTeams();

    console.log(
        "50 shared specialised rescue teams ready"
    );
}

startService().catch((error) => {
    console.error(
        "Failed to start Rescue Service:",
        error
    );

    process.exit(1);
});