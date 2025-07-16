import express from "express";
import expressWs from "express-ws";
import dotenv from "dotenv";
import crypto from 'crypto';
import axios from "axios";
import path from "path";
import WebSocket from 'ws';

import {
  AsyncRequestHandler,
  AudioDataEvent,
  VideoSeparatePngDataEvent,
  AudioSeparateRawDataEvent,
  TranscriptDataEvent,
  RecallBotWebSocketMessage,
} from "./types";

dotenv.config();

// Define a custom interface for the extended Express app
interface WsExpress extends express.Express {
  ws: typeof expressWs.prototype.ws;
  getWss: typeof expressWs.prototype.getWss;
}

const app = express() as WsExpress;
const expressPort = parseInt(process.env.PORT || "3456");
const wsInstance = expressWs(app);

// Store Zoom RTMS recording configuration globally
// In a real system we would likely want to store this per meeting
const zoom_recording_config = new Set<string>();
let zoom_websocket_url = "";

// --- UI WebSocket Server Setup ---
// This WebSocket server is for sending log messages from this backend to the browser UI.
const uiClients = new Set<WebSocket>();

app.ws("/ui-updates", (ws: WebSocket, res: express.Request) => {
  uiClients.add(ws);
  console.log("UI WebSocket client connected");
  broadcastToUIClients("New UI client connected to server logs.");

  ws.on("close", () => {
    uiClients.delete(ws);
    console.log("UI WebSocket client disconnected");
  });
  ws.on("error", (error) => console.error("UI WebSocket error:", error));
});
// Function to send a message to all connected browser UI clients
function broadcastToUIClients(logMessage: string, data?: any) {
  const message = JSON.stringify({
    log: logMessage,
    data: data,
    timestamp: new Date().toISOString(),
  });
  uiClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
  // Also log the broadcasted message to the server console
  console.log(`[UI Broadcast] ${logMessage}`, data || "");
}

// --- End UI WebSocket Server Setup ---

app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());

app.get("/", (req: express.Request, res: express.Response) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});


app.post("/zoom-webhook", async (req: express.Request, res: express.Response) => {
    broadcastToUIClients(
      "Received zoom webhook:",
      req.body
    );
    const { event, payload } = req.body;
    console.log("Received Zoom webhook event:", event, "with payload:", payload);

    // Handle URL validation event
    if (event === 'endpoint.url_validation' && payload?.plainToken) {
        // Generate a hash for URL validation using the plainToken and a secret token
        const zoom_secret_token = process.env.ZOOM_SECRET_TOKEN as string;
        const hash = crypto
            .createHmac('sha256', zoom_secret_token)
            .update(payload.plainToken)
            .digest('hex');
        console.log('Responding to URL validation challenge');
        res.json({
            plainToken: payload.plainToken,
            encryptedToken: hash,
        });
    }

    // Handle RTMS started event
    if (event === 'meeting.rtms_started') {
      const { meeting_uuid, rtms_stream_id, server_urls } = payload;
      const recall_payload: {[k: string]: any} = {
        zoom_rtms: {
          meeting_uuid,
          rtms_stream_id,
          server_urls,
          signature: generateSignature(meeting_uuid, rtms_stream_id)
        }
      };

      recall_payload.recording_config = getRecordingConfigFromOptions(Array.from(zoom_recording_config), zoom_websocket_url);
      const _ = await startRecallMeetingDirectConnect(recall_payload);
    }

    res.sendStatus(200);
});

// Function to generate a signature for authentication
function generateSignature(meetingUuid: string, streamId: string): string {
    // Create a message string and generate an HMAC SHA256 signature
    const message = `${process.env.ZOOM_CLIENT_ID},${meetingUuid},${streamId}`;
    const clientSecret: string = process.env.ZOOM_CLIENT_SECRET as string;
    return crypto.createHmac('sha256', clientSecret).update(message).digest('hex');
}

function getRecordingConfigFromOptions(eventsToRequest: Array<string>, wsUrl: string): object {
  const recording_config: {[k: string]: any} = {};
  
  const recallWebSocketPath = wsUrl.endsWith("/") ? "recall-events" : "/recall-events";
  console.log("wsUrl:", wsUrl);
  if (wsUrl.startsWith("http://")){
    wsUrl = "wss://" + wsUrl.substring("http://".length) + recallWebSocketPath;
  } else if(wsUrl.startsWith("https://")){
    wsUrl = "wss://" + wsUrl.substring("https://".length) + recallWebSocketPath;
  } else if(wsUrl.startsWith("wss://") || wsUrl.startsWith("ws://")){
    // already formatted
    wsUrl = wsUrl + recallWebSocketPath;
  }else if (wsUrl.length > 0){
    wsUrl = "wss://" + wsUrl + recallWebSocketPath;
  }
  console.log("Now wsUrl:", wsUrl);

  if (eventsToRequest.includes("audio_mixed_raw.data")) {
    recording_config.audio_mixed_raw = {};
  }
  if (
    eventsToRequest.includes("transcript.data") ||
    eventsToRequest.includes("transcript.partial_data")
  ) {
    recording_config.transcript = {
      provider: { meeting_captions: {} },
    };
  }
  if (eventsToRequest.includes("video_separate_png.data")) {
    recording_config.video_mixed_layout = "gallery_view_v2";
    recording_config.video_separate_png = {};
  }
  if (eventsToRequest.includes("audio_separate_raw.data")) {
    recording_config.audio_separate_raw = {};
  }

  if (wsUrl.length > 0) {
    recording_config.realtime_endpoints = [
      {
        type: "websocket",
        url: wsUrl,
        events: eventsToRequest,
            },
          ];
  }
  console.log("Recording config generated:", JSON.stringify(recording_config));
  return recording_config;
}

// --- Recall.ai API Interaction Endpoint ---
// Handles requests from the browser UI to send a bot to a meeting via Recall.ai API
const meetMediaMediaSendBotHandler: AsyncRequestHandler = async (req, res, next) => {
  const { space_name, access_token, recording_option_list, websocket_url } = req.body;
  const apiKey = process.env.RECALL_API_KEY;

  if (!space_name) {
    broadcastToUIClients("Error in /join-meet-meeting: space_name is required");
    return res.status(400).json({ error: "space_name is required" });
  }
  if (!access_token) {
    broadcastToUIClients("Error in /join-meet-meeting: access_token is required");
    return res.status(400).json({ error: "access_token is required" });
  }
  if (!apiKey) {
    broadcastToUIClients(
      "Error in /join-meet-meeting: RECALL_API_KEY is not set in server environment"
    );
    return res
      .status(500)
      .json({ error: "RECALL_API_KEY is not set in environment variables" });
  }

  try {
    const payload: any = {
      google_meet_media_api: {
        space_name: space_name,
        access_token: access_token
      }
    };
    payload.recording_config = getRecordingConfigFromOptions(recording_option_list, websocket_url);

    const recall_res = await startRecallMeetingDirectConnect(payload);
    if (!recall_res || !recall_res.data) {
      console.error("No data returned from Recall.ai API");
      broadcastToUIClients("No data returned from Recall.ai API");
      return res.status(500).json({ error: "Failed to start meeting bot" });
    }
    return res.status(recall_res.status).json(recall_res.data);
  } catch (error: any) {
    const errorMsg = error.response?.data || error.message;
    console.error("Error calling Recall.ai API:", errorMsg);
    broadcastToUIClients("Error calling Recall.ai API:", errorMsg);
    if (axios.isAxiosError(error) && error.response) {
      return res.status(error.response.status).json(error.response.data);
    }
    res.status(500).json({
      error: "Failed due to an internal server error.",
    });
  }
};
app.post("/join-meet-meeting", meetMediaMediaSendBotHandler);

const recordingConfigHandler: AsyncRequestHandler = async (req, res, next) => {
  const { checkbox_id, checkbox_on } = req.body;
  if (checkbox_on){
    console.log("Added recording config:", checkbox_id);
    zoom_recording_config.add(checkbox_id);
    broadcastToUIClients("Added:", checkbox_id)
  }else{
    console.log("Removed recording config:", checkbox_id);
    zoom_recording_config.delete(checkbox_id);
    broadcastToUIClients("Removed:", checkbox_id)
  }
  const configArray = Array.from(zoom_recording_config);
  broadcastToUIClients("Updated Zoom RTMS recording config:", configArray)
  res.status(200);
};
app.post("/set-recording-config", recordingConfigHandler);

const websocketUrlHandler: AsyncRequestHandler = async (req, res, next) => {
  const { websocket_url } = req.body;
  zoom_websocket_url = websocket_url;
  broadcastToUIClients("Updated Zoom RTMS websocket url:", websocket_url)
  res.status(200);
};
app.post("/set-websocket-url", websocketUrlHandler);

async function startRecallMeetingDirectConnect (payload: object) {
  // This function is called to start the Recall.ai meeting direct connect process.
  const recallApiUrl = "https://us-east-1.recall.ai/api/v1/meeting_direct_connect"; // Recall.ai endpoint to create a bot
  const apiKey = process.env.RECALL_API_KEY;

  // Prepare the payload for the Recall.ai API

  const payload_str = JSON.stringify(payload);
  broadcastToUIClients(
    "Sending request to Recall.ai API (/v1/direct_meeting_connect) with payload:",
    payload_str
  );
  let response;
  try {
  response = await axios.post(recallApiUrl, payload_str, {
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
  });
} catch (error: any) {
  const errorMsg = error.response?.data || error.message;
  console.error("Error calling Recall.ai API:", errorMsg);
  broadcastToUIClients("Error calling Recall.ai API:", errorMsg);
  return response;
}

  broadcastToUIClients(
    "Successfully called Recall.ai API. Response:",
    response.data
  );
  return response;
}


const queryZoomReadyHandler: AsyncRequestHandler = async (req, res, next) => {
  const apiKey = process.env.RECALL_API_KEY;

  if (apiKey === undefined || apiKey?.length === 0) {
    broadcastToUIClients("Error: Please set RECALL_API_KEY in your .env file");
    return res.status(500).json({ error: "No RECALL_API_KEY set" });
  }
  const zoomClientId = process.env.ZOOM_CLIENT_ID;
  if (zoomClientId === undefined || zoomClientId?.length === 0) {
    return res.status(500).json({ error: "Please set ZOOM_CLIENT_ID in your .env to use Zoom RTMS" });
  }
  const zoomClientSecret = process.env.ZOOM_CLIENT_SECRET;
  if (zoomClientSecret === undefined || zoomClientSecret?.length === 0) {
    return res.status(500).json({ error: "Please set ZOOM_CLIENT_SECRET in your .env to use Zoom RTMS" });
  }
  const zoomSecret = process.env.ZOOM_SECRET_TOKEN;
  if (zoomSecret === undefined || zoomSecret?.length === 0) {
    return res.status(500).json({ error: "Please set ZOOM_SECRET_TOKEN in your .env to use Zoom RTMS" });
  }
  return res.status(200).json({
    message: "Zoom RTMS is ready! Once your meeting starts, your webhook will be called and recording will start",
  });
};
app.get("/is-zoom-ready", queryZoomReadyHandler);

// --- End Recall.ai API Interaction Endpoint ---

// --- WebSocket Server for Recall.ai Bot Connections ---
// This server listens for incoming WebSocket connections from the Recall.ai bot after it has joined a meeting.
// It receives real-time events (audio, video, transcripts) from the bot.
app.ws("/recall-events", (ws: WebSocket, res: express.Request) => {
  uiClients.add(ws);
  console.log("Recall WebSocket client connected");
  const connectedMsg =
    "Recall Bot WebSocket client connected (Recall.ai bot has connected to this server).";
  console.log(connectedMsg);
  broadcastToUIClients(connectedMsg);

  // Handle messages received from a connected Recall.ai bot
  ws.on("message", (message: WebSocket.Data) => {
    try {
      const wsMessage = JSON.parse(
        message.toString()
      ) as RecallBotWebSocketMessage;

      // Process different types of real-time events from the bot
      if (wsMessage.event === "audio_mixed_raw.data") {
        const audioEvent = wsMessage as AudioDataEvent;
        const recId = audioEvent.data.recording.id;
        const audioMsg = `Received mixed audio (audio_mixed_raw.data) for recording ID: ${recId}`;
        broadcastToUIClients(audioMsg, {
          recordingId: recId,
          bufferSize: audioEvent.data.data.buffer.length,
        });
      } else if (wsMessage.event === "video_separate_png.data") {
        const videoEvent = wsMessage as VideoSeparatePngDataEvent;
        const participantInfo = videoEvent.data.data.participant;
        const videoMsg = `Received separate participant video (video_separate_png.data) for: ${
          participantInfo.name || participantInfo.id
        } (${videoEvent.data.data.type})`;
        broadcastToUIClients(videoMsg, {
          participant: participantInfo,
          type: videoEvent.data.data.type,
          timestamp: videoEvent.data.data.timestamp,
          bufferSize: videoEvent.data.data.buffer.length,
        });
      } else if (wsMessage.event === "audio_separate_raw.data") {
        const separateAudioEvent = wsMessage as AudioSeparateRawDataEvent;
        const participantInfo = separateAudioEvent.data.data.participant;
        const audioMsg = `Received separate participant audio (audio_separate_raw.data) for: ${
          participantInfo.name || participantInfo.id
        }`;
        broadcastToUIClients(audioMsg, {
          participant: participantInfo,
          timestamp: separateAudioEvent.data.data.timestamp,
          bufferSize: separateAudioEvent.data.data.buffer.length,
        });
      } else if (
        wsMessage.event === "transcript.data" ||
        wsMessage.event === "transcript.partial_data"
      ) {
        const transcriptEvent = wsMessage as TranscriptDataEvent;
        const eventMsg = `Received transcript event: ${transcriptEvent.event}`;
        broadcastToUIClients(eventMsg, transcriptEvent.data);
      } else {
        const unhandledMsg = `Unhandled Recall Bot WebSocket message event: ${wsMessage.event}`;
        broadcastToUIClients(unhandledMsg, wsMessage.data);
      }
    } catch (e: any) {
      const errorDetails = e.message || e;
      const errMsg =
        "Error parsing message from Recall Bot WebSocket or processing data:";
      console.error(
        errMsg,
        errorDetails,
        message.toString().substring(0, 200) + "..."
      ); // Log more of the message for debugging
      broadcastToUIClients(errMsg, {
        error: errorDetails,
        receivedMessage: message.toString().substring(0, 100) + "...",
      });
    }
  });

  ws.on("error", (error) => {
    const errMsg = "Recall Bot WebSocket connection error:";
    console.error(errMsg, error);
    broadcastToUIClients(errMsg, { error: error.message });
  });

  ws.on("close", () => {
    const closeMsg =
      "Recall Bot WebSocket client disconnected (Recall.ai bot disconnected).";
    console.log(closeMsg);
    broadcastToUIClients(closeMsg);
  });
});
// --- End WebSocket Server for Recall.ai Bot Connections ---

// Handle 404
app.use((req, res, next) => {
  res.status(404).send('Sorry, the page you requested could not be found.');
  if (req.path.endsWith("favicon.ico"))
    return;
  console.error(`404 Not Found: ${req.method} ${req.originalUrl}`);
  if (req.method == "POST"){
    broadcastToUIClients("Received 404 POST error, this may mean that your Zoom \"Event notification endpoint URL\" is configured for a different path! This sample expects /zoom-webhook");
  }
});

// Start the HTTP server (which also hosts the UI WebSocket server)
app.listen(expressPort, () => {
  const serverStartMsg = `HTTP server with UI WebSocket is running at http://localhost:${expressPort}`;
  console.log(serverStartMsg);
  broadcastToUIClients(serverStartMsg);
});
