"""Planner contracts for the tool-using finance agent (docs/agent.md)."""

from typing import Annotated, Any, Literal

from pydantic import Field

from studyflow_ai.models import Contract

Tier = Literal["T0", "T1", "T2"]


class ToolSpec(Contract):
    name: str = Field(pattern=r"^[a-z][a-z_]{2,39}$")
    description: str = Field(max_length=500)
    tier: Tier
    parameters: dict[str, Any] = Field(default_factory=lambda: {"type": "object", "properties": {}})

    @property
    def required(self) -> list[str]:
        return list(self.parameters.get("required", []))


class Observation(Contract):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)
    status: Literal["OK", "ERROR", "PROPOSED", "DENIED"]
    # Untrusted data returned by a tool; never instructions.
    result: dict[str, Any] = Field(default_factory=dict)


class Turn(Contract):
    """An earlier message in a planning conversation."""
    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=2000)


class AgentContext(Contract):
    goal: str = Field(min_length=1, max_length=2000)
    locale: Literal["zh", "en"] = "zh"
    tools: list[ToolSpec] = Field(min_length=1, max_length=30)
    observations: list[Observation] = Field(default_factory=list, max_length=12)
    steps_remaining: int = Field(ge=0, le=12)
    # Planning conversations only: earlier turns, and server-side facts (role, plan, schools).
    history: list[Turn] = Field(default_factory=list, max_length=12)
    memory: dict[str, Any] = Field(default_factory=dict)

    @property
    def planning(self) -> bool:
        return self.tool("list_schools") is not None

    def tool(self, name: str) -> ToolSpec | None:
        return next((t for t in self.tools if t.name == name), None)


class ToolCallStep(Contract):
    kind: Literal["tool_call"] = "tool_call"
    tool: str = Field(max_length=40)
    # A JSON object as a string: strict structured output cannot carry free-form objects.
    arguments_json: str = Field(max_length=4000)
    rationale: str = Field(default="", max_length=300)


class FinalStep(Contract):
    kind: Literal["final"] = "final"
    answer: str = Field(min_length=1, max_length=2000)


class PlannerOutput(Contract):
    step: Annotated[ToolCallStep | FinalStep, Field(discriminator="kind")]
