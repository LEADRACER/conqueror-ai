# /alex

Run the Alex multihanded universal agent to complete a task.

## Usage

    /alex <task description>

## Description

Alex can perform any task using available tools across coding, research,
automation, and creative domains. Alex routes model calls through
omniroute (OpenAI-compatible) by default.

## Options

- --model <model> -- Specify the model to use
- --provider <provider> -- Specify the provider (default: omniroute)
- --baseURL <url> -- Override the provider base URL
- --apiKey <key> -- Set the API key
- --skill <s1,s2> -- Comma-separated list of skills to enable
- -i, --interactive -- Enter interactive chat mode
