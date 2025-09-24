// api/parse-email.js

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the request body
    const { emailContent } = req.body;
    
    if (!emailContent || !emailContent.trim()) {
      return res.status(400).json({ error: 'Email content is required' });
    }

    // Check for OpenAI API key
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Create the prompt for OpenAI
    const systemPrompt = `You are an expert project manager who extracts actionable tasks from client emails and feedback. 

Your job is to:
1. Read the email/feedback content
2. Extract a meaningful project name (if possible from context)
3. Identify all actionable tasks, especially those with time codes
4. Format each task with an appropriate emoji and clear description
5. Preserve any specific time codes mentioned

Return your response as a JSON object with this exact structure:
{
  "projectName": "Brief descriptive project name",
  "tasks": [
    {
      "emoji": "🎵",
      "text": "0:12 – Finesse music transition (longer lead-in before crash)"
    },
    {
      "emoji": "⚡",
      "text": "0:17 – Remove flashes"
    }
  ]
}

Choose emojis that match the task type:
- 🎵 🔊 for audio/music tasks
- 🎬 ✂️ for video editing
- ⚡ 💥 for effects/transitions  
- 🎨 🌈 for color/visual tasks
- ⏰ 📅 for timing/scheduling
- 👤 😐 for talent/performance notes
- 📐 🔧 for technical adjustments
- 📤 ✅ for delivery/completion tasks

Keep task descriptions concise but include all important details and time codes.`;

    const userPrompt = `Please parse this client email/feedback and extract actionable tasks:

${emailContent}`;

    // Make the API call to OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',  // Using GPT-4 for better parsing
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: userPrompt
          }
        ],
        temperature: 0.3,  // Lower temperature for more consistent parsing
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('OpenAI API Error:', errorData);
      
      let errorMessage = 'Failed to parse email with AI';
      if (response.status === 401) {
        errorMessage = 'Invalid OpenAI API key';
      } else if (response.status === 429) {
        errorMessage = 'OpenAI API rate limit exceeded. Please try again in a moment.';
      } else if (response.status === 403) {
        errorMessage = 'OpenAI API access denied. Please check your API key permissions.';
      }
      
      return res.status(response.status).json({ error: errorMessage });
    }

    const data = await response.json();
    
    // Extract the AI response
    const aiResponse = data.choices?.[0]?.message?.content;
    if (!aiResponse) {
      return res.status(500).json({ error: 'No response from AI' });
    }

    // Parse the JSON response from AI
    let parsedResponse;
    try {
      // Clean up the response in case AI included code blocks
      const cleanResponse = aiResponse
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      parsedResponse = JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      console.error('AI Response was:', aiResponse);
      
      // Fallback: try to extract tasks manually
      const lines = aiResponse.split('\n').filter(line => line.trim());
      const tasks = [];
      let projectName = 'AI Generated Project';
      
      for (const line of lines) {
        // Look for task-like patterns
        if (line.includes('–') || line.includes('-') || line.includes(':')) {
          const emoji = line.match(/^[^\w\s]/)?.[0] || '📝';
          const text = line.replace(/^[^\w\s]\s*/, '').trim();
          if (text) {
            tasks.push({ emoji, text });
          }
        }
        // Look for project name
        if (line.toLowerCase().includes('project') && projectName === 'AI Generated Project') {
          projectName = line.replace(/[^\w\s]/g, '').trim();
        }
      }
      
      parsedResponse = { projectName, tasks };
    }

    // Validate the response structure
    if (!parsedResponse.tasks || !Array.isArray(parsedResponse.tasks)) {
      return res.status(500).json({ 
        error: 'AI response format was invalid. Please try again or check your email format.' 
      });
    }

    // Clean up and validate tasks
    const cleanTasks = parsedResponse.tasks
      .filter(task => task.text && task.text.trim())
      .map(task => ({
        emoji: task.emoji || '📝',
        text: task.text.trim()
      }))
      .slice(0, 20); // Limit to 20 tasks max

    if (cleanTasks.length === 0) {
      return res.status(400).json({ 
        error: 'No actionable tasks found in the email. Please check the content and try again.' 
      });
    }

    // Return the parsed result
    return res.status(200).json({
      projectName: parsedResponse.projectName || 'AI Generated Project',
      tasks: cleanTasks,
      originalTaskCount: parsedResponse.tasks.length
    });

  } catch (error) {
    console.error('Function error:', error);
    
    return res.status(500).json({ 
      error: 'Internal server error. Please try again.' 
    });
  }
}
