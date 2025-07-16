# Recall.ai Meeting Direct Connect Sample for Zoom RTMS and Google Meet

This sample demonstrates how to interact with the Recall.ai API to connect to either Zoom RTMS or Google Meet without a bot!

## Zoom RTMS Limitations
- Requires a properly configured Zoom App, which needs to go through [Zoom's application process](https://developers.zoom.us/docs/distribute/app-review-process/)
- You can only receive data (no sending messages or [output media](https://docs.recall.ai/reference/bot_output_media_create))
- Zoom RTMS doesn't provide chat messages (currently)
- Breakout rooms are not supported

## Google Meet Media Limitations
- Currently, all participants need to be enrolled in Google's [developer program](https://docs.google.com/forms/d/e/1FAIpQLSd7BiMXXHDlUDkF7G0TSY5zfJbQwFNH3m6K_ZYFi3vCHLFbng/viewform?resourcekey=0-1uHeVg8junj3PPTLNcn7WQ)
- Google's Meet Media API only sends audio and video of the 3 most relevant participants at any given time
- You can only receive data (no sending messages or [output media](https://docs.recall.ai/reference/bot_output_media_create))
- Breakout rooms are not supported
- Meet Media API doesn’t send out transcriptions of the meeting, so instead of requesting [meeting_captions](https://docs.recall.ai/docs/meeting-caption-transcription) you’ll need to use one of our [Transcription Providers](https://docs.recall.ai/docs/ai-transcription)

Fortunately, with Recall, if at any point you want to get around these issues you can easily switch from the botless form factor of this repo to instead including a bot with one simple API :)

## Prerequisites
- **Node.js** (v16 or higher recommended)
- **npm** (comes with Node.js)
- **Recall.ai API Key**: You'll need an API key from your [Recall.ai Dashboard](https://us-west-2.recall.ai/dashboard/developers/api-keys).
- **Ngrok** (or a similar tunneling service): Required to expose your local WebSocket server to the internet so Recall.ai can connect to it for real-time event delivery. You can download it from [ngrok.com](https://ngrok.com/download).

## Setup Ngrok
Both Zoom and Google Meet will require a static url for authentication. After making an [Ngrok account](https://dashboard.ngrok.com/signup), find your [Ngrok static domain](https://dashboard.ngrok.com/domains) we will call this domain `my-random-domain.ngrok-free.app`

## Zoom RTMS Setup
- Create or edit your [Zoom App](https://marketplace.zoom.us/)
- In the top right, click Develop -> Build App
- Select User Managed App
- Copy your Client ID and Client Secret
- Click on "Basic Information" (below "Build your app")
    - Add an OAuth Redirect URL
    - For example, your ngrok url + /oauth-callback/zoom like `https://my-random-domain.ngrok-free.app/oauth-callback/zoom`
- Click on "Access" (below "Build your app" and "Features")
    - Copy your Secret Token
    - Enable "Event Subscription"
        - Name the webhook (e.g. My Recall RTMS webhook)
        - Choose option "Webhook"
        - Click "Add Events"
            - Search "RTMS" and select "Select All RTMS"
        - In "Event notification endpoint URL"
            - Add your Ngrok static domain followed by /zoom-webhook
            - e.g. `https://my-random-domain.ngrok-free.app/zoom-webhook`
        - Select "Save"
- On the left, under "Build your app" select "Scopes"
    - Select "Meeting" under "Product"
    - Click on "Real-time media streams notifications"
    - Enable all the real-time media streams scopes:
        - meeting:read:meeting_audio
        - meeting:read:meeting_chat
        - meeting:read:meeting_transcript
        - meeting:read:meeting_screenshare
        - meeting:read:meeting_video
    - Click "Done"
- Click "Local Test" under "Add your App"
    - Click "Add App Now"
    - You will see a confirmation prompt, click "Allow"
    - You will get redirected, the end url may show an error but that's ok! We now have a Zoom RTMS App!
- Go to your [Zoom App Settings](https://zoom.us/profile/setting?tab=zoomapps)
    - Under "Auto-start apps that access shared realtime meeting content" click "Choose an app to auto-start"
    - In the dropdown select your new app
Your Zoom App is now setup for RTMS :)

## Google Cloud Setup
- Access or create a Google Cloud Account and get the Project ID
- Join Google Cloud Developer Program, using your project ID
- Create a [Google Client ID](https://console.developers.google.com/auth/clients)
    - Add an Authorized Javascript origin with your [ngrok static domain](https://dashboard.ngrok.com/domains)
    - Save this Client ID
- Enable the [Google Meet API](https://console.cloud.google.com/apis/library/meet.googleapis.com)

## Features
- Receive media without bots!
- Receive subscriptions for various real-time events:
  - Mixed audio from the call (`audio_mixed_raw.data`)
  - Separate participant video (`video_separate_png.data`)
  - Separate participant audio (`audio_separate_raw.data`)
  - **Zoom only** Full and partial transcripts (`transcript.data`, `transcript.partial_data`)
- Real-time log display in the browser showing events received from the Recall.ai bot via WebSockets.

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/recallai/meeting-direct-connect.git
cd meeting-direct-connect
```

### 2. Install Dependencies

Navigate to the project directory and install the necessary packages:

```bash
npm install
```

### 3. Configure Environment Variables

This project uses a `.env` file to manage sensitive information and configuration.

1.  **Create a `.env` file:** In the root of the project, create a new file named `.env`.
    You can copy the `env.example` file if one is provided in the repository:

    ```bash
    cp .env.example .env
    ```

2.  **Add Your Recall.ai API Key:** Open the `.env` file and add your Recall.ai API key:

    ```env
    RECALL_API_KEY=YOUR_RECALL_API_KEY_HERE
    ```
3. **Add Your Zoom Credentials:** For Zoom RTMS, you will need to add the Client ID, Client Secret, and Zoom Secret that you received earlier to your env file

    ```env
    ZOOM_CLIENT_ID=YOUR_ZOOM_CLIENT_ID
    ZOOM_CLIENT_SECRET=YOUR_ZOOM_CLIENT_SECRET
    ZOOM_SECRET_TOKEN=YOUR_ZOOM_SECRET_TOKEN
    ```

### 4. Set up Ngrok (for Real-time Events)

To receive real-time events from the Recall.ai bot, your local server's WebSocket endpoint needs to be publicly accessible. Ngrok is a great tool for this.

**Start Ngrok:** Open a new terminal window and run ngrok to forward to your **Server Port** (default is `3456`, or the `PORT` you set in `.env`).
_Change *my-random-domain.ngrok-free.app* to your ngrok static domain!_
```bash
ngrok http --url=my-random-domain.ngrok-free.app 3456
```

_(If you configured a different `PORT`, use that number instead of 3456.)_

### 5. Run the Application

Once dependencies are installed and your `.env` file is configured, start the server:

```bash
npm run dev
```

By default, the web UI will be accessible at `http://localhost:3456` (or your configured `PORT`).
The server console will show messages indicating that the HTTP server and the Recall Bot WebSocket server are running.

## Using the Application

1.  **Open the Web UI:** Go to your static ngrok domain `my-random-domain.ngrok-free.app`

2.  **Enter Meeting Details:**

    For Zoom RTMS
    - All Zoom settings are in your .env
    - If that's good, and your zoom app is configured correctly, all you need to do is start the meeting and this sample will auto-join!
    
    For Google Meet Media API
    - **Space Name:** Provide the Google Meet space name, this will be the last 12 letters of a Meet url https:&zwnj;//meet.google.com/`xxx-xxxx-xxx`
    - **Client ID** This will be the client ID you generated in your Google Cloud Project
    - **OAuth ID** Click the "Get OAuth via Login" button to generate a temporary OAuth access token
    

3.  **Select Real-time Event Subscriptions:**

    - Check the boxes for the real-time events you want to receive (e.g., mixed audio, transcripts, separate participant video/audio).

4.  **Connect to the Meeting:**

    For Google Meet Media API
    - Start a Google Meet and enter the space name
    - Click "Direct Connect"

    For Zoom RTMS
    - If your settings are properly configured, all you need to do is start the meeting! Zoom will call the webhook you configured, which will in turn call the Recall API to connect to your meeting

5.  **Observe Logs:**

    - The "Real-time Server Log" section on the web page will display:
      - Status messages from the server (e.g., API call attempts, WebSocket connections).
      - The actual real-time event data received from the Recall.ai bot.
    - The server console (where you ran `npm run dev`) will also show these logs and any errors.

If anything is unclear or confusing, please feel free to open an issue! We're obsessed with building the best platform for extracting knowledge from conversational data!
