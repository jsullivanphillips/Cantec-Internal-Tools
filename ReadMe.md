# Schedule Assist

Schedule Assist is a Flask-based scheduling application. This guide will help you set up and run the application on a new Windows computer using a virtual environment and Waitress as the production-grade WSGI server.

---

## Prerequisites

- **Python 3.8+**: Download and install Python from [python.org](https://www.python.org/downloads/).
- **pip**: Comes installed with Python 3.8+.
- **Virtual Environment**: We will use Python's built-in `venv` module.

---

## Setup Instructions

### 1. Unzip the Project

Unzip the project folder to your desired location on your computer.

### 2. Create and Activate a Virtual Environment

1. Open a Command Prompt (or PowerShell) and navigate to your project directory:
   ```bash
   cd path\to\your\project

2. Create a virtual environment:
   python -m venv venv

3. Activate the virtual environment:
   - Command Prompt:
      venv\Scripts\activate


### 3. Install Dependencies

pip install -r requirements.txt

### 4. Run the Application with Waitress

waitress-serve --host=0.0.0.0 --port=8000 app:app

### 5. Access the Application
On the same machine:
Open your browser and navigate to:
http://localhost:8000

On another machine on your local network:
Determine your machine’s local IP address (using ipconfig in Command Prompt) and then access the app by navigating to:
http://<your-local-ip>:8000
For example, if your local IP is 192.168.1.100, visit:
http://192.168.1.100:8000