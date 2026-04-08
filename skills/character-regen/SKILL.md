---
name: character-regen
description: Regenerate or reuse a character from a previous edu-video project. Pass a character's reference sheet and recreation prompt to produce the character in a new pose, scene, or expression. Use when the user says "recreate character", "use Droppy in a new scene", "regenerate character", "reuse character", "character in a different pose", or references an existing character from a previous video project.
---

# Character Regeneration

Recreate an existing character in a new pose, scene, or expression using their reference sheets and recreation prompt from a previous video project.

## When to Use

- User wants to reuse a character from a previous `/edu-video` project in a new context
- User wants to place an existing character in a custom scene or illustration
- User wants to generate a character in a specific pose or expression for print, social media, or other use

## Prerequisites

The character must have been created with the `/edu-video` skill. You need:

1. **Recreation prompt file**: `{project}/characters/{name}-recreation-prompt.md`
2. **Reference sheet(s)**: `{project}/characters/{name}-poses.jpg` and/or `{name}-expressions.jpg`

## Workflow

### Step 1 — Locate Character Assets

Ask the user which character to regenerate. Then find the character's files:

```bash
ls -d "${PWD}"/*/characters/ 2>/dev/null
```

Read the recreation prompt file to get the character's exact description and style.

### Step 2 — Collect Scene Details

Ask the user:
1. **What scene/context?**
2. **What pose?** — Reference the pose sheet
3. **What expression?** — Reference the expression sheet
4. **Output size/aspect?** — 16:9, 9:16, 1:1, or custom
5. **Any additional elements?**

### Step 3 — Generate the Image

Build the prompt using the EXACT character description from the recreation prompt (verbatim):

```bash
GEMINI_API_KEY="$GEMINI_API_KEY" node __PLUGIN_DIR__/scripts/generate-image.mjs \
  --prompt "{CHARACTER_DESCRIPTION_VERBATIM}. Scene: {user_scene}. Pose: {user_pose}. Expression: {user_expression}. {STYLE} animation style. {additional_elements}. High quality, vibrant, educational." \
  --reference "{project}/characters/{name}-poses.jpg" \
  --output "{output_path}" \
  --aspect "{aspect}"
```

### Step 4 — Review and Iterate

Display the generated image. Ask: "Does this look right? Any changes?"

The character description must stay verbatim — only change the scene, pose, expression, and style details.

### Step 5 — Save Prompt

Save the generation prompt alongside the output.

## Tips

- Always use the pose sheet as `--reference` for best consistency
- The recreation prompt file contains a copy-paste-ready prompt — use it as the base
- Wait 35 seconds between Gemini calls to avoid rate limits
