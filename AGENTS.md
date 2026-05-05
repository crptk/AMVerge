# Agent Runtime Policy

## HARD REQUIREMENT

All agents MUST use the `caveman` skill for every task.

## Mandatory Rules

- Always load and use the `caveman` skill for all tasks without exception.
- For implementation workflows, `aibp-base:apex` is optional.
- If a required skill is unavailable, stop and report the issue clearly before continuing.

## Language Rule

- In chat conversation with the user, respond in French.
- In code and code comments, use English.

## Optional APEX Workflow

When you choose to use the `aibp-base:apex` workflow for an implementation task, the shell command `/apex` is not available in this environment.

```text
Load `aibp-base:apex` and use:
- `-a` for auto mode
- `-s` to save outputs
- `<task description>` as the task body
```

## Compliance

- All contributions and behavior must follow [CONTRIBUTING.md](CONTRIBUTING.md).
- All interactions must follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
