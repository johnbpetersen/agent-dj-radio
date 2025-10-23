import type { VercelRequest, VercelResponse } from '@vercel/node'
import { secureHandler, securityConfigs } from '../_shared/secure-handler.js'

async function privacyPolicyHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const privacyPolicy = {
    title: "Privacy Policy",
    lastUpdated: "2024-09-02",
    content: {
      introduction: "Agent DJ Radio is committed to protecting your privacy. This Privacy Policy explains how we collect, use, and safeguard your information when you use our service.",
      
      informationWeCollect: {
        title: "Information We Collect",
        sections: [
          {
            subtitle: "Information You Provide",
            description: "When you submit music prompts, we collect the text of your prompts and associate them with a temporary user identifier."
          },
          {
            subtitle: "Usage Information",
            description: "We collect information about how you interact with our service, including reactions to tracks (love, fire, skip) and general usage patterns."
          },
          {
            subtitle: "Technical Information",
            description: "We collect basic technical information such as IP address, browser type, and device information for security and performance purposes."
          }
        ]
      },

      howWeUseInformation: {
        title: "How We Use Your Information",
        purposes: [
          "To generate AI music based on your prompts",
          "To provide and improve our radio service",
          "To prevent abuse and maintain service quality",
          "To analyze usage patterns for service improvement",
          "To comply with legal obligations"
        ]
      },

      informationSharing: {
        title: "Information Sharing",
        description: "We do not sell, trade, or otherwise transfer your personal information to third parties except as described below:",
        exceptions: [
          "Service providers who assist us in operating our service (ElevenLabs for music generation)",
          "When required by law or to protect our rights",
          "In connection with a business transfer or merger"
        ]
      },

      dataRetention: {
        title: "Data Retention",
        description: "We retain your information for as long as necessary to provide our services and comply with legal obligations. Music prompts and reactions are retained indefinitely to maintain the radio experience for all users."
      },

      userRights: {
        title: "Your Rights",
        description: "You have the right to request access to, correction of, or deletion of your personal information. Contact us to exercise these rights."
      },

      security: {
        title: "Security",
        description: "We implement appropriate technical and organizational measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction."
      },

      cookies: {
        title: "Cookies and Tracking",
        description: "We use minimal tracking technologies. Our service uses browser local storage to maintain your session and preferences."
      },

      thirdPartyServices: {
        title: "Third-Party Services",
        services: [
          {
            name: "ElevenLabs",
            purpose: "AI music generation",
            dataShared: "Music prompts only"
          },
          {
            name: "Supabase",
            purpose: "Database and authentication",
            dataShared: "User data and service interactions"
          },
          {
            name: "Vercel",
            purpose: "Hosting and deployment",
            dataShared: "Technical logs and performance data"
          }
        ]
      },

      childrensPrivacy: {
        title: "Children's Privacy",
        description: "Our service is not intended for children under 13. We do not knowingly collect personal information from children under 13."
      },

      changes: {
        title: "Changes to This Policy",
        description: "We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the 'Last Updated' date."
      },

      contact: {
        title: "Contact Us",
        description: "If you have any questions about this Privacy Policy, please contact us through our GitHub repository."
      }
    }
  }

  res.status(200).json(privacyPolicy)
}

export default secureHandler(privacyPolicyHandler, securityConfigs.public)