import { defineEventHandler, sendRedirect } from 'h3'
import { clearUserSession } from '../utils/session'

export default defineEventHandler(async (event) => {
  await clearUserSession(event)

  return sendRedirect(event, '/')
})
