import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import StoryViewer from './Stories'

function renderStoryViewer(
  allStories: Array<{ id?: string; name?: string; img?: string; video?: string }>,
  users?: Array<{ username?: string; role?: string }>,
) {
  return render(
    <StoryViewer
      idx={0}
      setIdx={() => {}}
      allStories={allStories}
      {...(users === undefined ? {} : { users })}
    />,
  )
}

describe('Stories viewer regression coverage', () => {
  it('does not crash when opened with an empty story list', () => {
    expect(() => renderStoryViewer([])).not.toThrow()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not crash when opened without the users prop', () => {
    expect(() =>
      renderStoryViewer([{ id: 'story-1', name: 'allan', img: 'https://example.com/story.jpg' }]),
    ).not.toThrow()

    expect(screen.getByRole('dialog', { name: 'allan story' })).toBeInTheDocument()
  })

  it('does not crash when the story media URL fails', () => {
    renderStoryViewer([{ id: 'broken-story', name: 'allan', img: 'https://invalid.example/story.jpg' }])

    const image = screen.getByRole('img', { name: /allan story/i })
    expect(() => fireEvent.error(image)).not.toThrow()
    expect(screen.getByRole('dialog', { name: 'allan story' })).toBeInTheDocument()
  })
})
