import { NextApiRequest, NextApiResponse } from "next";
import Cors from "cors";
import { render_prompt_for_pi_detection } from "@/lib/templates";
import {
  DetectApiFailureResponse,
  DetectApiSuccessResponse,
} from "@/lib/rebuff";
import {
  runMiddleware,
  isApiKeyValidAndHasCredits,
  detectPiUsingVectorDatabase,
  detectPromptInjectionUsingHeuristicOnInput,
  callOpenAiToDetectPI,
} from "@/lib/detect-helpers";

// Constants
const SIMILARITY_THRESHOLD = 0.9;

const cors = Cors({
  methods: ["POST"],
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<any>
) {
  await runMiddleware(req, res, cors);
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "not_allowed",
      message: "Method not allowed",
    } as DetectApiFailureResponse);
  }
  try {
    // Extract the API key from the Authorization header
    const apiKey = req.headers.authorization?.split(" ")[1];

    // Assert that the API key is present
    if (!apiKey) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Missing API key",
      } as DetectApiFailureResponse);
    }

    // Validate the API key
    const isValidApiKey = await isApiKeyValidAndHasCredits(apiKey);

    if (!isValidApiKey) {
      return res.status(401).json({
        error: "unauthorized",
        message: "Invalid API key",
      } as DetectApiFailureResponse);
    }

    let {
      input_base64,
      runHeuristicCheck = true,
      runVectorCheck = true,
      runLanguageModelCheck = true,
      maxHeuristicScore = null,
      maxModelScore = null,
      maxVectorScore = null,
    } = req.body;

    if (
      maxHeuristicScore === null ||
      maxModelScore === null ||
      maxVectorScore === null
    ) {
      return res.status(400).json({
        error: "bad_request",
        message:
          "maxHeuristicScore, maxModelScore, and maxVectorScore are required",
      } as DetectApiFailureResponse);
    }

    runHeuristicCheck = runHeuristicCheck === null ? true : runHeuristicCheck;
    runVectorCheck = runVectorCheck === null ? true : runVectorCheck;
    runLanguageModelCheck =
      runLanguageModelCheck === null ? true : runLanguageModelCheck;

    if (!input_base64) {
      return res.status(400).json({
        error: "bad_request",
        message: "input_base64 is required",
      } as DetectApiFailureResponse);
    }

    // Create a buffer from the hexadecimal string
    const userInputBuffer = Buffer.from(input_base64, "hex");

    // Decode the buffer to a UTF-8 string
    const inputText = userInputBuffer.toString("utf-8");

    const heuristicScore = runHeuristicCheck
      ? detectPromptInjectionUsingHeuristicOnInput(inputText)
      : 0;

    const modelScore = runLanguageModelCheck
      ? parseFloat(
          (
            await callOpenAiToDetectPI(
              render_prompt_for_pi_detection(inputText)
            )
          ).completion
        )
      : 0;

    const vectorScore = runVectorCheck
      ? await detectPiUsingVectorDatabase(inputText, maxVectorScore)
      : { topScore: 0, countOverMaxVectorScore: 0 };

    const response: DetectApiSuccessResponse = {
      heuristicScore,
      modelScore,
      vectorScore,
      runHeuristicCheck,
      runVectorCheck,
      runLanguageModelCheck,
      maxHeuristicScore,
      maxVectorScore,
      maxModelScore,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in detect API:");
    console.error(error);
    console.trace();
    return res.status(500).json({
      error: "server_error",
      message: "Internal server error",
    } as DetectApiFailureResponse);
  }
}
