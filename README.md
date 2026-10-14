# Server Monitoring Dashboard

A lightweight server monitoring application built with Node.js and Express.js.
It provides real-time information about server health, memory usage, CPU activity, and disk storage through a web dashboard and JSON API endpoints.

## Dashboard Preview

Here is a preview of the server monitoring dashboard:

![Server Monitoring Dashboard](screenshots/dashboard.png)

## Features

- **Interactive Dashboard:** Displays server statistics through a clean HTML interface.
- **Health Check:** Verifies whether the application is running.
- **Memory Monitoring:** Reports available system and Node.js process memory metrics.
- **CPU Monitoring:** Displays system CPU usage and process CPU activity.
- **Disk Monitoring:** Provides information about root filesystem storage.
- **JSON API:** Exposes monitoring data through dedicated endpoints.
- **Auto-refresh:** Updates the dashboard automatically every few seconds.

## Technologies

- Node.js
- Express.js
- HTML5
- CSS3
- JavaScript
- Git and GitHub

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Displays the monitoring dashboard. |
| `/health` | Returns the application's health status in JSON format. |
| `/stats` | Returns server and process statistics in JSON format. |

## Installation

### 1. Clone the repository

```bash
git clone git@github.com:OnjaniainaSafidy/p-render.git
cd p-render
