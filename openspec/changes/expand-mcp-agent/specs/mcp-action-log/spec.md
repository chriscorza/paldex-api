# MCP Action Log

## Purpose

Record what the AI agent did through MCP, with the state before and after each write, so writes can be made idempotent, the agent can be limited to deleting what it created, and the owner can review what happened.

## ADDED Requirements

### Requirement: Every MCP write is logged

Every successful write through MCP SHALL create an `mcp_actions` row with the key, the caller, the books owner, the tool, the entity and its id, the action, the `client_ref` if any, and the public projection of the record before and after. Prisma rows SHALL NOT be stored directly.

#### Scenario: Updating an expense

- **WHEN** the agent changes the amount of an expense
- **THEN** a row with `action: 'update'` holds the expense before and after the change

#### Scenario: Logging fails after the write

- **WHEN** the domain write succeeds but writing the log fails twice
- **THEN** the response carries an `ACTION_NOT_LOGGED` warning and the failure is logged at error level with the payload

### Requirement: The owner can review the log

`GET /mcp-actions` SHALL list the log for the effective owner, filterable by date range, entity and tool, newest first, and SHALL require `mcp_action:read`. It SHALL NOT accept an API key.

#### Scenario: What did the agent do yesterday

- **WHEN** the owner asks for yesterday's range
- **THEN** every write the agent made yesterday is listed with its before and after
