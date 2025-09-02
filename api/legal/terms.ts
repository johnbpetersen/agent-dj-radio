import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../_shared/secure-handler'

async function termsOfServiceHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const termsOfService = {
    title: "Terms of Service",
    lastUpdated: "2024-09-02",
    content: {
      introduction: {
        title: "Introduction",
        description: "Welcome to Agent DJ Radio. These Terms of Service ('Terms') govern your use of our AI-generated music radio service. By accessing or using our service, you agree to be bound by these Terms."
      },

      serviceDescription: {
        title: "Service Description",
        description: "Agent DJ Radio is an experimental AI-powered music radio service where users can submit prompts to generate music that plays for all listeners. The service includes features for reactions, payments, and community interaction."
      },

      acceptableUse: {
        title: "Acceptable Use",
        description: "You agree to use our service only for lawful purposes. Specifically, you agree NOT to:",
        prohibitedActivities: [
          "Submit prompts containing illegal, harmful, or offensive content",
          "Attempt to abuse, spam, or overload our systems",
          "Violate any applicable laws or regulations",
          "Infringe on the intellectual property rights of others",
          "Submit prompts designed to generate copyrighted material",
          "Use automated tools to interact with our service",
          "Attempt to reverse engineer or hack our systems",
          "Submit false or misleading information"
        ]
      },

      userContent: {
        title: "User-Generated Content",
        description: "When you submit music prompts:",
        terms: [
          "You retain ownership of your original prompts",
          "You grant us a worldwide, royalty-free license to use your prompts to generate music",
          "Generated music becomes part of our shared radio experience",
          "You are responsible for ensuring your prompts comply with these Terms",
          "We reserve the right to remove or refuse any prompt at our discretion"
        ]
      },

      payments: {
        title: "Payments and Billing",
        description: "Our service may include paid features:",
        terms: [
          "Payments are processed through third-party providers",
          "All fees are non-refundable unless required by law",
          "We use Base blockchain and USDC for payments",
          "Payment confirmation may take several minutes",
          "Failed payments will not result in track generation",
          "We reserve the right to modify pricing at any time"
        ]
      },

      intellectualProperty: {
        title: "Intellectual Property",
        description: "Our service and its content are protected by intellectual property laws:",
        terms: [
          "Agent DJ Radio service and software are our property",
          "AI-generated music is created using third-party AI models",
          "You may not claim ownership of AI-generated content",
          "Our trademarks and branding remain our exclusive property"
        ]
      },

      serviceAvailability: {
        title: "Service Availability",
        description: "We strive to maintain service availability but cannot guarantee uninterrupted access:",
        disclaimers: [
          "Service may be temporarily unavailable for maintenance",
          "We may suspend or terminate service at any time",
          "Third-party dependencies may affect service availability",
          "We do not guarantee music generation success rates"
        ]
      },

      privacy: {
        title: "Privacy",
        description: "Your privacy is important to us. Please review our Privacy Policy, which explains how we collect, use, and protect your information."
      },

      disclaimers: {
        title: "Disclaimers",
        description: "Our service is provided 'as is' without warranties:",
        disclaimers: [
          "We do not warrant the quality or accuracy of AI-generated content",
          "Music generation results may vary and are not guaranteed",
          "Service is experimental and may contain bugs or errors",
          "We are not responsible for third-party service failures",
          "Use of blockchain and cryptocurrency involves inherent risks"
        ]
      },

      limitationOfLiability: {
        title: "Limitation of Liability",
        description: "To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues."
      },

      termination: {
        title: "Termination",
        description: "We reserve the right to terminate or suspend your access to our service at any time, without prior notice, for conduct that we believe violates these Terms or is harmful to other users or our service."
      },

      modifications: {
        title: "Modifications to Terms",
        description: "We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting. Your continued use of the service after changes constitutes acceptance of the new Terms."
      },

      governingLaw: {
        title: "Governing Law",
        description: "These Terms shall be governed by and construed in accordance with applicable laws, without regard to conflict of law principles."
      },

      severability: {
        title: "Severability",
        description: "If any provision of these Terms is found to be unenforceable, the remaining provisions will remain in full force and effect."
      },

      contact: {
        title: "Contact Information",
        description: "If you have any questions about these Terms of Service, please contact us through our GitHub repository or official support channels."
      },

      acknowledgment: {
        title: "Acknowledgment",
        description: "By using Agent DJ Radio, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service."
      }
    }
  }

  res.status(200).json(termsOfService)
}

export default secureHandler(termsOfServiceHandler, securityConfigs.public)